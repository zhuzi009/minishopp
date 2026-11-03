require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL;

const db = new Database("minishop.sqlite");
db.pragma("journal_mode = WAL");

// ДЕРЕКҚОР
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  payment_id TEXT,
  payment_method TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// ТАУАРЛАР
const PRODUCTS = [
  {
    id: 1,
    name: "Күнделікті кроссовка",
    category: "Аяқ киім",
    price: 18900,
    emoji: "👟",
    description: "Күнделікті киюге ыңғайлы, жеңіл кроссовка."
  },
  {
    id: 2,
    name: "Классикалық сөмке",
    category: "Сөмке",
    price: 15900,
    emoji: "👜",
    description: "Күнделікті образға арналған сәнді сөмке."
  },
  {
    id: 3,
    name: "Минималист сағат",
    category: "Аксессуар",
    price: 12500,
    emoji: "⌚",
    description: "Қарапайым әрі әдемі дизайндағы сағат."
  },
  {
    id: 4,
    name: "Күннен қорғайтын көзілдірік",
    category: "Аксессуар",
    price: 8900,
    emoji: "🕶️",
    description: "Жеңіл жақтаулы сәнді көзілдірік."
  },
  {
    id: 5,
    name: "Ақ базалық футболка",
    category: "Киім",
    price: 6900,
    emoji: "👕",
    description: "Жұмсақ матадан тігілген базалық футболка."
  },
  {
    id: 6,
    name: "Әйелдерге арналған әмиян",
    category: "Сөмке",
    price: 9900,
    emoji: "👛",
    description: "Ықшам, күнделікті қолдануға ыңғайлы әмиян."
  }
];

// НЕГІЗГІ БАПТАУЛАР
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: "."
  }),

  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// HTML, CSS, JS ФАЙЛДАРЫ
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10
});

// ЖҮЙЕГЕ КІРУДІ ТЕКСЕРУ
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Алдымен жүйеге кіріңіз."
    });
  }

  next();
}

function money(amount) {
  return new Intl.NumberFormat("kk-KZ")
    .format(amount) + " ₸";
}

// ТӨЛЕМ ҚОЛТАҢБАСЫ
function freedomPaySignature(scriptName, params, secret) {
  const values = Object.keys(params)
    .filter(key => key !== "pg_sig")
    .sort()
    .flatMap(key => {
      const value = params[key];

      if (value && typeof value === "object") {
        return Object.keys(value)
          .sort()
          .map(sub => String(value[sub]));
      }

      return [String(value)];
    });

  return crypto.createHash("md5")
    .update([scriptName, ...values, secret].join(";"))
    .digest("hex");
}

function verifyFreedomPay(params) {
  if (
    !params.pg_sig ||
    !process.env.FREEDOMPAY_SECRET_KEY
  ) {
    return false;
  }

  const expected = freedomPaySignature(
    "result",
    params,
    process.env.FREEDOMPAY_SECRET_KEY
  );

  const received = String(params.pg_sig);

  return expected.length === received.length &&
    crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(received)
    );
}

function parseXmlValue(xml, tag) {
  const match = xml.match(
    new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
  );

  return match ? match[1].trim() : null;
}

// ТАУАРЛАР ТІЗІМІ
app.get("/api/products", (req, res) => {
  res.json(PRODUCTS);
});

// ПАЙДАЛАНУШЫНЫ ТЕКСЕРУ
app.get("/api/me", (req, res) => {
  res.json({
    user: req.session.user || null
  });
});

// ТІРКЕЛУ
app.post("/api/register", authLimiter, async (req, res) => {
  const { name, email, password } = req.body || {};

  if (
    !name ||
    !email ||
    !password ||
    password.length < 8
  ) {
    return res.status(400).json({
      error: "Аты-жөніңізді, email және кемінде 8 таңбалы құпиясөз енгізіңіз."
    });
  }

  const normalizedEmail = String(email)
    .trim()
    .toLowerCase();

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `).run(
      String(name).trim(),
      normalizedEmail,
      hash
    );

    req.session.user = {
      id: result.lastInsertRowid,
      name: String(name).trim(),
      email: normalizedEmail
    };

    res.json({
      user: req.session.user
    });

  } catch (error) {
    res.status(409).json({
      error: "Бұл email бұрын тіркелген болуы мүмкін."
    });
  }
});

// ЖҮЙЕГЕ КІРУ
app.post("/api/login", authLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  const user = db.prepare(
    "SELECT * FROM users WHERE email = ?"
  ).get(
    String(email || "").trim().toLowerCase()
  );

  if (
    !user ||
    !(await bcrypt.compare(
      String(password || ""),
      user.password_hash
    ))
  ) {
    return res.status(401).json({
      error: "Email немесе құпиясөз қате."
    });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email
  };

  res.json({
    user: req.session.user
  });
});

// ЖҮЙЕДЕН ШЫҒУ
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ТАПСЫРЫСТАР ТАРИХЫ
app.get("/api/orders", requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT
      id,
      customer_name,
      phone,
      address,
      items_json,
      total,
      status,
      payment_method,
      created_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.session.user.id);

  res.json(
    orders.map(order => ({
      ...order,
      items: JSON.parse(order.items_json),
      total_label: money(order.total)
    }))
  );
});

// ТАПСЫРЫС ЖӘНЕ ТӨЛЕМ
app.post(
  "/api/checkout",
  requireAuth,
  paymentLimiter,
  async (req, res) => {
    try {
      if (
        !BASE_URL ||
        !process.env.FREEDOMPAY_MERCHANT_ID ||
        !process.env.FREEDOMPAY_SECRET_KEY
      ) {
        return res.status(503).json({
          error: "Төлем жүйесі әлі бапталмаған. Freedom Pay деректерін серверге енгізу қажет."
        });
      }

      const {
        items,
        customerName,
        phone,
        address
      } = req.body || {};

      if (
        !Array.isArray(items) ||
        !items.length ||
        !customerName ||
        !phone ||
        !address
      ) {
        return res.status(400).json({
          error: "Себет пен жеткізу деректерін толық толтырыңыз."
        });
      }

      // БАҒАНЫ СЕРВЕР ӨЗІ ЕСЕПТЕЙДІ
      const safeItems = items.map(row => {
        const product = PRODUCTS.find(
          p => p.id === Number(row.id)
        );

        const quantity = Math.max(
          1,
          Math.min(20, Number(row.quantity) || 1)
        );

        if (!product) {
          throw new Error("Тауар табылмады.");
        }

        return {
          id: product.id,
          name: product.name,
          price: product.price,
          quantity
        };
      });

      const total = safeItems.reduce(
        (sum, item) =>
          sum + item.price * item.quantity,
        0
      );

      const orderId =
        "MS" +
        Date.now() +
        crypto.randomBytes(3).toString("hex");

      db.prepare(`
        INSERT INTO orders (
          id,
          user_id,
          customer_name,
          phone,
          address,
          items_json,
          total,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_payment')
      `).run(
        orderId,
        req.session.user.id,
        String(customerName).trim(),
        String(phone).trim(),
        String(address).trim(),
        JSON.stringify(safeItems),
        total
      );

      // FREEDOM PAY ПАРАМЕТРЛЕРІ
      const params = {
        pg_merchant_id: String(
          process.env.FREEDOMPAY_MERCHANT_ID
        ),

        pg_order_id: orderId,
        pg_amount: total.toFixed(2),
        pg_currency: "KZT",

        pg_description: "MiniShop тапсырысы " + orderId,

        pg_salt: crypto.randomBytes(12).toString("hex"),
        pg_language: "kk",

        pg_user_contact_email: req.session.user.email,

        pg_result_url:
          BASE_URL + "/api/payments/freedompay/result",

        pg_success_url:
          BASE_URL + "/?payment=success",

        pg_failure_url:
          BASE_URL + "/?payment=failed",

        pg_testing_mode:
          process.env.FREEDOMPAY_TEST_MODE === "0"
            ? "0"
            : "1"
      };

      params.pg_sig = freedomPaySignature(
        "init_payment",
        params,
        process.env.FREEDOMPAY_SECRET_KEY
      );

      const response = await fetch(
        "https://api.freedompay.kz/init_payment",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body: new URLSearchParams(params)
        }
      );

      const xml = await response.text();

      const status = parseXmlValue(xml, "pg_status");
      const redirectUrl = parseXmlValue(
        xml,
        "pg_redirect_url"
      );

      if (
        !response.ok ||
        status !== "ok" ||
        !redirectUrl ||
        !redirectUrl.startsWith("https://")
      ) {
        console.error("FreedomPay error:", xml);

        return res.status(502).json({
          error: "Төлем сілтемесін жасау мүмкін болмады."
        });
      }

      res.json({
        redirectUrl,
        orderId
      });

    } catch (error) {
      res.status(400).json({
        error: error.message ||
          "Тапсырыс рәсімдеу кезінде қате болды."
      });
    }
  }
);

// ТӨЛЕМ НӘТИЖЕСІН ҚАБЫЛДАУ
app.post(
  "/api/payments/freedompay/result",
  (req, res) => {

    const params = req.body || {};

    const orderId = String(
      params.pg_order_id || ""
    );

    const order = db.prepare(
      "SELECT * FROM orders WHERE id = ?"
    ).get(orderId);

    if (!order || !verifyFreedomPay(params)) {
      return res
        .status(400)
        .type("application/xml")
        .send(
          "<response><pg_status>rejected</pg_status></response>"
        );
    }

    const isPaid = String(params.pg_result) === "1";

    db.prepare(`
      UPDATE orders
      SET status = ?,
          payment_id = ?,
          payment_method = ?
      WHERE id = ?
    `).run(
      isPaid ? "paid" : "failed",
      String(params.pg_payment_id || ""),
      String(params.pg_payment_method || ""),
      orderId
    );

    res
      .status(200)
      .type("application/xml")
      .send(
        "<response><pg_status>ok</pg_status></response>"
      );
  }
);

// СЕРВЕРДІ ТЕКСЕРУ
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "MiniShop сервері жұмыс істеп тұр."
  });
});

// СЕРВЕРДІ ІСКЕ ҚОСУ
app.listen(PORT, () => {
  console.log(
    `MiniShop server running on port ${PORT}`
  );
});
