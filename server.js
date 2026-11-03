const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database("minishop.sqlite");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT DEFAULT 'paid_demo',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const PRODUCTS = [
  {
    id: 1,
    name: "Күнделікті кроссовка",
    category: "Аяқ киім",
    price: 18900,
    emoji: "👟",
    description: "Күнделікті киюге ыңғайлы кроссовка."
  },
  {
    id: 2,
    name: "Классикалық сөмке",
    category: "Сөмке",
    price: 15900,
    emoji: "👜",
    description: "Сәнді әрі ыңғайлы сөмке."
  },
  {
    id: 3,
    name: "Минималист сағат",
    category: "Аксессуар",
    price: 12500,
    emoji: "⌚",
    description: "Әдемі дизайндағы сағат."
  },
  {
    id: 4,
    name: "Күннен қорғайтын көзілдірік",
    category: "Аксессуар",
    price: 8900,
    emoji: "🕶️",
    description: "Сәнді күннен қорғайтын көзілдірік."
  },
  {
    id: 5,
    name: "Ақ базалық футболка",
    category: "Киім",
    price: 6900,
    emoji: "👕",
    description: "Жұмсақ матадан тігілген футболка."
  },
  {
    id: 6,
    name: "Әйелдер әмияны",
    category: "Сөмке",
    price: 9900,
    emoji: "👛",
    description: "Ықшам әрі ыңғайлы әмиян."
  }
];

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Алдымен жүйеге кіріңіз."
    });
  }

  next();
}

function money(amount) {
  return new Intl.NumberFormat("kk-KZ").format(amount) + " ₸";
}

// Тауарлар
app.get("/api/products", (req, res) => {
  res.json(PRODUCTS);
});

// Қолданушыны тексеру
app.get("/api/me", (req, res) => {
  res.json({
    user: req.session.user || null
  });
});

// Тіркелу
app.post("/api/register", limiter, async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({
      error: "Барлық жолды толтырыңыз. Құпиясөз кемінде 8 таңба болуы керек."
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `).run(String(name).trim(), normalizedEmail, hash);

    req.session.user = {
      id: result.lastInsertRowid,
      name: String(name).trim(),
      email: normalizedEmail
    };

    res.json({ user: req.session.user });

  } catch (error) {
    res.status(409).json({
      error: "Бұл email бұрын тіркелген."
    });
  }
});

// Кіру
app.post("/api/login", limiter, async (req, res) => {
  const { email, password } = req.body;

  const user = db.prepare(
    "SELECT * FROM users WHERE email = ?"
  ).get(String(email || "").trim().toLowerCase());

  if (!user || !(await bcrypt.compare(
    String(password || ""),
    user.password_hash
  ))) {
    return res.status(401).json({
      error: "Email немесе құпиясөз қате."
    });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email
  };

  res.json({ user: req.session.user });
});

// Шығу
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Тапсырыс рәсімдеу — ДЕМО ТӨЛЕМ
app.post("/api/checkout", requireAuth, limiter, (req, res) => {
  try {
    const {
      items,
      customerName,
      phone,
      address,
      paymentMethod
    } = req.body;

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      !customerName ||
      !phone ||
      !address
    ) {
      return res.status(400).json({
        error: "Тапсырыс деректерін толық толтырыңыз."
      });
    }

    if (!["Kaspi", "Карта"].includes(paymentMethod)) {
      return res.status(400).json({
        error: "Төлем әдісін таңдаңыз."
      });
    }

    const safeItems = items.map(item => {
      const product = PRODUCTS.find(
        p => p.id === Number(item.id)
      );

      const quantity = Number(item.quantity);

      if (
        !product ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 20
      ) {
        throw new Error("Тауар деректері дұрыс емес.");
      }

      return {
        id: product.id,
        name: product.name,
        price: product.price,
        quantity
      };
    });

    const total = safeItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const orderId = "MS-" + Date.now();

    // Демо нұсқада төлем бірден расталған деп белгіленеді.
    db.prepare(`
      INSERT INTO orders (
        id,
        user_id,
        customer_name,
        phone,
        address,
        items_json,
        total,
        payment_method,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      req.session.user.id,
      String(customerName).trim(),
      String(phone).trim(),
      String(address).trim(),
      JSON.stringify(safeItems),
      total,
      paymentMethod,
      "paid_demo"
    );

    res.json({
      success: true,
      orderId,
      message: "Демо тапсырыс сәтті рәсімделді!",
      redirectUrl: "/?payment=success&order=" + orderId
    });

  } catch (error) {
    res.status(400).json({
      error: error.message || "Тапсырыс рәсімделмеді."
    });
  }
});

// Тапсырыстар тарихы
app.get("/api/orders", requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.session.user.id);

  res.json(orders.map(order => ({
    ...order,
    items: JSON.parse(order.items_json),
    total_label: money(order.total)
  })));
});

// Серверді тексеру
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "MiniShop сервері жұмыс істеп тұр!"
  });
});

app.listen(PORT, () => {
  console.log("MiniShop іске қосылды: " + PORT);
});
