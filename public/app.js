const $ = (selector) => document.querySelector(selector);

const money = (amount) =>
  new Intl.NumberFormat("kk-KZ").format(amount) + " ₸";

let products = [];
let cart = JSON.parse(localStorage.getItem("minishop_cart") || "[]");
let category = "Барлығы";
let authMode = "login";
let currentUser = null;

// Сервермен байланыс
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Қате орын алды.");
  }

  return data;
}

// Хабарлама
function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");

  setTimeout(() => {
    element.classList.remove("show");
  }, 2500);
}

// Терезелер
function openOverlay(id) {
  $("#" + id).classList.add("show");
}

function closeOverlay(id) {
  $("#" + id).classList.remove("show");
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    closeOverlay(button.dataset.close);
  });
});

document.querySelectorAll(".overlay").forEach(overlay => {
  overlay.addEventListener("click", event => {
    if (event.target === overlay) {
      overlay.classList.remove("show");
    }
  });
});

// Тауарларды жүктеу
async function loadProducts() {
  products = await api("/api/products");
  renderProducts();
  renderCart();
}

// Каталог
function renderProducts() {
  const term = ($("#search").value || "").toLowerCase();

  const shown = products.filter(product =>
    (category === "Барлығы" || product.category === category) &&
    (
      product.name.toLowerCase().includes(term) ||
      product.description.toLowerCase().includes(term)
    )
  );

  $("#products").innerHTML = shown.length
    ? shown.map(product => `
      <article class="product">
        <div class="product-art">${product.emoji}</div>

        <div class="product-info">
          <span class="product-category">${product.category}</span>
          <h3>${product.name}</h3>
          <p>${product.description}</p>

          <div class="product-bottom">
            <strong class="product-price">
              ${money(product.price)}
            </strong>

            <button class="add-btn" data-add="${product.id}">
              + Себетке
            </button>
          </div>
        </div>
      </article>
    `).join("")
    : "<p>Бұл санатта тауар табылмады.</p>";

  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      addToCart(Number(button.dataset.add));
    });
  });
}

// Іздеу
$("#search").addEventListener("input", renderProducts);

// Санат бойынша сүзу
$("#filters").addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;

  category = button.dataset.category;

  document.querySelectorAll(".filter").forEach(item => {
    item.classList.toggle("active", item === button);
  });

  renderProducts();
});

// Себетті сақтау
function saveCart() {
  localStorage.setItem("minishop_cart", JSON.stringify(cart));
  renderCart();
}

// Себетке қосу
function addToCart(id) {
  const item = cart.find(product => product.id === id);

  if (item) {
    item.quantity = Math.min(20, item.quantity + 1);
  } else {
    cart.push({ id, quantity: 1 });
  }

  saveCart();
  toast("Тауар себетке қосылды!");
}

// Себет тауарлары
function cartProducts() {
  return cart
    .map(item => ({
      ...products.find(product => product.id === item.id),
      quantity: item.quantity
    }))
    .filter(product => product.id);
}

// Жалпы соманы есептеу
function total() {
  return cartProducts().reduce(
    (sum, product) => sum + product.price * product.quantity,
    0
  );
}

// Себетті көрсету
function renderCart() {
  const items = cartProducts();

  const count = items.reduce(
    (sum, product) => sum + product.quantity,
    0
  );

  $("#cartCount").textContent = count;
  $("#heroCount").textContent = count;

  $("#heroTotal").textContent = money(total());
  $("#cartTotal").textContent = money(total());
  $("#checkoutTotal").textContent = money(total());

  $("#heroProgress").style.width =
    Math.min(100, count * 25) + "%";

  $("#cartItems").innerHTML = items.length
    ? items.map(product => `
      <div class="cart-row">
        <div class="cart-emoji">${product.emoji}</div>

        <div class="cart-desc">
          <b>${product.name}</b>
          <small>
            ${money(product.price)} × ${product.quantity}
          </small>
        </div>

        <div class="qty">
          <button data-dec="${product.id}">−</button>
          <b>${product.quantity}</b>
          <button data-inc="${product.id}">+</button>
        </div>

        <button class="remove" data-remove="${product.id}">
          ×
        </button>
      </div>
    `).join("")
    : '<p class="hint">Себет әзірге бос. Каталогтан тауар таңдаңыз.</p>';

  document.querySelectorAll("[data-inc]").forEach(button => {
    button.onclick = () => changeQty(Number(button.dataset.inc), 1);
  });

  document.querySelectorAll("[data-dec]").forEach(button => {
    button.onclick = () => changeQty(Number(button.dataset.dec), -1);
  });

  document.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = () => {
      cart = cart.filter(
        item => item.id !== Number(button.dataset.remove)
      );
      saveCart();
    };
  });
}

// Тауар санын өзгерту
function changeQty(id, delta) {
  const item = cart.find(product => product.id === id);
  if (!item) return;

  item.quantity += delta;

  if (item.quantity <= 0) {
    cart = cart.filter(product => product.id !== id);
  }

  saveCart();
}

// Басты беттен себетке қосу
document.querySelectorAll("[data-quick-add]").forEach(button => {
  button.addEventListener("click", () => {
    addToCart(Number(button.dataset.quickAdd));
  });
});

// Себетті ашу
$("#cartOpen").onclick = () => {
  openOverlay("cartOverlay");
};

// Тапсырыс рәсімдеу терезесі
$("#checkoutBtn").onclick = () => {
  if (!cart.length) {
    return toast("Себет бос!");
  }

  if (!currentUser) {
    closeOverlay("cartOverlay");
    openAuth("login");
    return toast("Алдымен жүйеге кіріңіз.");
  }

  closeOverlay("cartOverlay");
  openOverlay("checkoutOverlay");
};

// Кіру және тіркелу
function openAuth(mode) {
  authMode = mode;

  $("#authTitle").textContent =
    mode === "login" ? "Жүйеге кіру" : "Тіркелу";

  $("#authSubmit").textContent =
    mode === "login" ? "Кіру →" : "Аккаунт ашу →";

  $("#nameLabel").classList.toggle(
    "hidden",
    mode === "login"
  );

  $("#switchAuth").innerHTML =
    mode === "login"
      ? 'Аккаунтыңыз жоқ па? <button type="button">Тіркелу</button>'
      : 'Аккаунтыңыз бар ма? <button type="button">Кіру</button>';

  $("#switchAuth").querySelector("button").onclick = () => {
    openAuth(mode === "login" ? "register" : "login");
  };

  $("#authMessage").textContent = "";
  openOverlay("authOverlay");
}

// Аккаунт батырмасы
$("#accountBtn").onclick = () => {
  if (currentUser) {
    showOrders();
  } else {
    openAuth("login");
  }
};

// Тіркелу және кіру
$("#authForm").onsubmit = async event => {
  event.preventDefault();

  $("#authMessage").textContent = "";

  const form = new FormData(event.target);
  const body = Object.fromEntries(form.entries());

  try {
    const data = await api(
      "/api/" + (authMode === "login" ? "login" : "register"),
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );

    currentUser = data.user;

    closeOverlay("authOverlay");
    updateAccountButton();

    toast("Қош келдіңіз, " + currentUser.name + "!");

  } catch (error) {
    $("#authMessage").textContent = error.message;
  }
};

// Аккаунт батырмасын жаңарту
function updateAccountButton() {
  $("#accountBtn").textContent = currentUser
    ? "Менің тапсырыстарым"
    : "Кіру";
}

// Пайдаланушыны тексеру
async function checkUser() {
  try {
    const data = await api("/api/me");
    currentUser = data.user;
    updateAccountButton();
  } catch (error) {
    console.error(error);
  }
}

// ТАПСЫРЫС ЖӘНЕ ДЕМО ТӨЛЕМ
$("#checkoutForm").onsubmit = async event => {
  event.preventDefault();

  $("#checkoutMessage").textContent = "";

  const form = new FormData(event.target);

  const body = Object.fromEntries(form.entries());

  // Таңдалған төлем әдісін серверге жіберу
  body.paymentMethod = form.get("paymentMethod");

  // Себеттегі тауарларды жіберу
  body.items = cart.map(item => ({
    id: item.id,
    quantity: item.quantity
  }));

  try {
    const result = await api("/api/checkout", {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (result.success) {
      cart = [];
      saveCart();

      closeOverlay("checkoutOverlay");

      event.target.reset();

      toast("Тапсырыс сәтті рәсімделді! №" + result.orderId);

      // Тапсырыстар тарихын ашу
      await showOrders();
    }

  } catch (error) {
    $("#checkoutMessage").textContent = error.message;
  }
};

// Тапсырыстар тарихы
async function showOrders() {
  try {
    const orders = await api("/api/orders");

    $("#ordersList").innerHTML = orders.length
      ? orders.map(order => `
        <div class="order-card">

          <b>Тапсырыс №${order.id}</b>

          <span class="status">
            · ${
              order.status === "paid_demo"
                ? "Демо төлем расталды"
                : "Төлем мәртебесі белгісіз"
            }
          </span>

          <small>
            ${order.items.map(item =>
              `${item.name} × ${item.quantity}`
            ).join(", ")}
          </small>

          <small>
            Жалпы: ${order.total_label}
          </small>

          <small>
            Төлем әдісі: ${order.payment_method}
          </small>

        </div>
      `).join("")
      : "<p>Әзірге тапсырыс жоқ.</p>";

    openOverlay("ordersOverlay");

  } catch (error) {
    toast(error.message);
  }
}

// Жүйеден шығу
$("#logoutBtn").onclick = async () => {
  try {
    await api("/api/logout", {
      method: "POST",
      body: "{}"
    });

    currentUser = null;
    updateAccountButton();

    closeOverlay("ordersOverlay");

    toast("Жүйеден шықтыңыз!");

  } catch (error) {
    toast(error.message);
  }
};

// Төлем нәтижесі туралы хабарлама
const paymentState =
  new URLSearchParams(location.search).get("payment");

if (paymentState === "success") {
  toast("Тапсырыс сәтті рәсімделді!");
}

if (paymentState === "failed") {
  toast("Тапсырыс аяқталмады.");
}

// Сайтты іске қосу
checkUser();

loadProducts().catch(error => {
  $("#products").textContent = error.message;
});
