const $ = (s) => document.querySelector(s);
const money = (n) => new Intl.NumberFormat("kk-KZ").format(n) + " ₸";
let products = [], cart = JSON.parse(localStorage.getItem("minishop_cart") || "[]");
let category = "Барлығы", authMode = "login", currentUser = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Сұраныс орындалмады.");
  return data;
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}
function openOverlay(id) { $("#" + id).classList.add("show"); }
function closeOverlay(id) { $("#" + id).classList.remove("show"); }
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeOverlay(b.dataset.close)));
document.querySelectorAll(".overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) o.classList.remove("show"); }));

async function loadProducts() {
  products = await api("/api/products");
  renderProducts();
  renderCart();
}
function renderProducts() {
  const term = ($("#search").value || "").toLowerCase();
  const shown = products.filter(p => (category === "Барлығы" || p.category === category) &&
    (p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)));
  $("#products").innerHTML = shown.length ? shown.map(p => `
    <article class="product">
      <div class="product-art">${p.emoji}</div>
      <div class="product-info">
        <span class="product-category">${p.category}</span>
        <h3>${p.name}</h3><p>${p.description}</p>
        <div class="product-bottom"><strong class="product-price">${money(p.price)}</strong>
          <button class="add-btn" data-add="${p.id}">+ Себетке</button></div>
      </div>
    </article>`).join("") : "<p>Бұл санатта тауар табылмады.</p>";
  document.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => addToCart(Number(b.dataset.add))));
}
$("#search").addEventListener("input", renderProducts);
$("#filters").addEventListener("click", e => {
  const b = e.target.closest("[data-category]"); if (!b) return;
  category = b.dataset.category;
  document.querySelectorAll(".filter").forEach(x => x.classList.toggle("active", x === b));
  renderProducts();
});

function saveCart() { localStorage.setItem("minishop_cart", JSON.stringify(cart)); renderCart(); }
function addToCart(id) {
  const item = cart.find(x => x.id === id);
  if (item) item.quantity = Math.min(20, item.quantity + 1);
  else cart.push({ id, quantity: 1 });
  saveCart(); toast("Тауар себетке қосылды.");
}
function cartProducts() { return cart.map(c => ({ ...products.find(p => p.id === c.id), quantity: c.quantity })).filter(p => p.id); }
function total() { return cartProducts().reduce((s, p) => s + p.price * p.quantity, 0); }
function renderCart() {
  const items = cartProducts(), count = items.reduce((s,p)=>s+p.quantity,0);
  $("#cartCount").textContent = count; $("#heroCount").textContent = count;
  $("#heroTotal").textContent = money(total()); $("#cartTotal").textContent = money(total());
  $("#checkoutTotal").textContent = money(total());
  $("#heroProgress").style.width = Math.min(100, count * 25) + "%";
  $("#cartItems").innerHTML = items.length ? items.map(p => `
    <div class="cart-row">
      <div class="cart-emoji">${p.emoji}</div><div class="cart-desc"><b>${p.name}</b><small>${money(p.price)} × ${p.quantity}</small></div>
      <div class="qty"><button data-dec="${p.id}">−</button><b>${p.quantity}</b><button data-inc="${p.id}">+</button></div>
      <button class="remove" data-remove="${p.id}">×</button>
    </div>`).join("") : '<p class="hint">Себет әзірге бос. Каталогтан тауар таңдаңыз.</p>';
  document.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => changeQty(+b.dataset.inc, 1));
  document.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => changeQty(+b.dataset.dec, -1));
  document.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { cart = cart.filter(x => x.id !== +b.dataset.remove); saveCart(); });
}
function changeQty(id, delta) {
  const item = cart.find(x => x.id === id); if (!item) return;
  item.quantity += delta; if (item.quantity <= 0) cart = cart.filter(x => x.id !== id);
  saveCart();
}
document.querySelectorAll("[data-quick-add]").forEach(b => b.addEventListener("click", () => addToCart(+b.dataset.quickAdd)));
$("#cartOpen").onclick = () => openOverlay("cartOverlay");
$("#checkoutBtn").onclick = async () => {
  if (!cart.length) return toast("Себет бос.");
  if (!currentUser) { closeOverlay("cartOverlay"); openAuth("login"); return toast("Тапсырыс беру үшін жүйеге кіріңіз."); }
  closeOverlay("cartOverlay"); openOverlay("checkoutOverlay");
};

function openAuth(mode) {
  authMode = mode;
  $("#authTitle").textContent = mode === "login" ? "Жүйеге кіру" : "Тіркелу";
  $("#authSubmit").textContent = mode === "login" ? "Кіру →" : "Аккаунт ашу →";
  $("#nameLabel").classList.toggle("hidden", mode === "login");
  $("#switchAuth").innerHTML = mode === "login" ? 'Аккаунтыңыз жоқ па? <button type="button">Тіркелу</button>' : 'Аккаунтыңыз бар ма? <button type="button">Кіру</button>';
  $("#switchAuth").querySelector("button").onclick = () => openAuth(mode === "login" ? "register" : "login");
  $("#authMessage").textContent = "";
  openOverlay("authOverlay");
}
$("#accountBtn").onclick = () => currentUser ? showOrders() : openAuth("login");
$("#authForm").onsubmit = async e => {
  e.preventDefault(); $("#authMessage").textContent = "";
  const form = new FormData(e.target), body = Object.fromEntries(form.entries());
  try {
    const data = await api("/api/" + (authMode === "login" ? "login" : "register"), { method: "POST", body: JSON.stringify(body) });
    currentUser = data.user; closeOverlay("authOverlay"); updateAccountButton(); toast("Қош келдіңіз, " + currentUser.name + "!");
  } catch (err) { $("#authMessage").textContent = err.message; }
};
async function checkUser() {
  try { const data = await api("/api/me"); currentUser = data.user; updateAccountButton(); } catch {}
}
function updateAccountButton() { $("#accountBtn").textContent = currentUser ? "Менің тапсырыстарым" : "Кіру"; }

$("#checkoutForm").onsubmit = async e => {
  e.preventDefault(); $("#checkoutMessage").textContent = "";
  const form = new FormData(e.target), body = Object.fromEntries(form.entries());
  body.items = cart.map(x => ({ id: x.id, quantity: x.quantity }));
  try {
    const result = await api("/api/checkout", { method: "POST", body: JSON.stringify(body) });
    window.location.href = result.redirectUrl;
  } catch (err) { $("#checkoutMessage").textContent = err.message; }
};

async function showOrders() {
  try {
    const orders = await api("/api/orders");
    $("#ordersList").innerHTML = orders.length ? orders.map(o => `
      <div class="order-card"><b>Тапсырыс №${o.id}</b><span class="status"> · ${o.status === "paid" ? "Төленді" : o.status === "failed" ? "Төлем өтпеді" : "Төлем күтілуде"}</span>
      <small>${o.items.map(i => `${i.name} × ${i.quantity}`).join(", ")}</small><small>Жалпы: ${o.total_label}</small></div>`).join("") : "<p>Әзірге тапсырыс жоқ.</p>";
    openOverlay("ordersOverlay");
  } catch (e) { toast(e.message); }
}
$("#logoutBtn").onclick = async () => { await api("/api/logout", { method: "POST", body: "{}" }); currentUser = null; updateAccountButton(); closeOverlay("ordersOverlay"); toast("Жүйеден шықтыңыз."); };

const paymentState = new URLSearchParams(location.search).get("payment");
if (paymentState === "success") toast("Төлем бетіне қайттыңыз. Тапсырыс мәртебесі сервер хабарламасымен жаңартылады.");
if (paymentState === "failed") toast("Төлем аяқталмады. Тапсырыстар бөлімінен мәртебесін тексеріңіз.");
checkUser();
loadProducts().catch(err => { $("#products").textContent = err.message; });
