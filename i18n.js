// ─────────────────────────────────────────────
//  i18n.js  —  Magizham Language Support
//  Supports: English (en) + Arabic (ar)
//  Usage: include this before your page script
// ─────────────────────────────────────────────

const TRANSLATIONS = {
  en: {
    // Tracking page
    liveTracking:      "🚚 Live Tracking",
    connecting:        "Connecting...",
    onTheWay:          "On the way 🚚",
    arriving:          "Arriving 🚀",
    delivered:         "Delivered ✅",
    confirmed:         "Confirmed 🏪",
    connectionLost:    "⚠️ Connection lost",
    reconnecting:      "⚠️ Reconnecting...",
    serverOffline:     "⚠️ Server offline",
    offlineBanner:     "⚠️ Cannot connect — live tracking unavailable.",
    retry:             "Retry",
    loadingOrder:      "Loading your order...",
    fetchingOrder:     "Fetching your order...",
    orderNotFound:     "❌ Order not found. Check the link.",
    noOrderId:         "❌ No order ID in URL. Use /track/123",

    // Timeline steps
    placed:            "Placed",
    confirmedStep:     "Confirmed",
    onTheWayStep:      "On the way",
    deliveredStep:     "Delivered",

    // Info cards
    distance:          "📍 Distance",
    eta:               "⏱ ETA",
    speedLabel:        "🏍 Speed",

    // Rider card
    loading:           "Loading...",
    callBtn:           "📞 Call",

    // Delivery popup
    orderDelivered:    "Order Delivered!",
    deliveredMsg:      "Your Magizham order has been delivered successfully.",
    greatThanks:       "Great, thanks!",

    // Speech
    speechArriving:    "Your order is arriving soon!",
    speechDelivered:   "Your Magizham order has been delivered!",
    speechOnTheWay:    "Your rider is on the way!",

    // Rider app
    riderApp:          "Rider App",
    enterOrderId:      "Enter Order ID",
    load:              "Load",
    startGPS:          "▶ Start Sharing GPS",
    stopGPS:           "⏹ Stop GPS",
    currentLocation:   "📍 CURRENT LOCATION",
    latitude:          "Latitude",
    longitude:         "Longitude",
    accuracy:          "Accuracy",
    lastSent:          "Last Sent",
    activityLog:       "🗺 ACTIVITY LOG",
    riderReady:        "🛵 Rider app ready",
    online:            "Online",
    offline:           "Offline",
    yourOrder:         "🧡 YOUR ORDER",
    orderStatus:       "📋 ORDER STATUS",
  },

  ar: {
    // Tracking page
    liveTracking:      "🚚 التتبع المباشر",
    connecting:        "جارٍ الاتصال...",
    onTheWay:          "في الطريق 🚚",
    arriving:          "يصل الآن 🚀",
    delivered:         "تم التوصيل ✅",
    confirmed:         "تم التأكيد 🏪",
    connectionLost:    "⚠️ انقطع الاتصال",
    reconnecting:      "⚠️ جارٍ إعادة الاتصال...",
    serverOffline:     "⚠️ الخادم غير متاح",
    offlineBanner:     "⚠️ تعذّر الاتصال — التتبع المباشر غير متاح.",
    retry:             "إعادة المحاولة",
    loadingOrder:      "جارٍ تحميل طلبك...",
    fetchingOrder:     "جارٍ جلب بيانات طلبك...",
    orderNotFound:     "❌ الطلب غير موجود. تحقق من الرابط.",
    noOrderId:         "❌ لا يوجد رقم طلب في الرابط. استخدم /track/123",

    // Timeline steps
    placed:            "تم الطلب",
    confirmedStep:     "مؤكّد",
    onTheWayStep:      "في الطريق",
    deliveredStep:     "تم التوصيل",

    // Info cards
    distance:          "📍 المسافة",
    eta:               "⏱ وقت الوصول",
    speedLabel:        "🏍 السرعة",

    // Rider card
    loading:           "جارٍ التحميل...",
    callBtn:           "📞 اتصال",

    // Delivery popup
    orderDelivered:    "تم توصيل طلبك!",
    deliveredMsg:      "تم توصيل طلبك من مكيظم بنجاح.",
    greatThanks:       "رائع، شكراً!",

    // Speech
    speechArriving:    "طلبك سيصل قريباً!",
    speechDelivered:   "تم توصيل طلبك من مكيظم!",
    speechOnTheWay:    "المندوب في طريقه إليك!",

    // Rider app
    riderApp:          "تطبيق المندوب",
    enterOrderId:      "أدخل رقم الطلب",
    load:              "تحميل",
    startGPS:          "▶ بدء مشاركة الموقع",
    stopGPS:           "⏹ إيقاف GPS",
    currentLocation:   "📍 الموقع الحالي",
    latitude:          "خط العرض",
    longitude:         "خط الطول",
    accuracy:          "الدقة",
    lastSent:          "آخر إرسال",
    activityLog:       "🗺 سجل النشاط",
    riderReady:        "🛵 تطبيق المندوب جاهز",
    online:            "متصل",
    offline:           "غير متصل",
    yourOrder:         "🧡 طلبك",
    orderStatus:       "📋 حالة الطلب",
  }
};

// ── Detect saved language or browser language ──────────────
function detectLang() {
  const saved = localStorage.getItem("magizham_lang");
  if (saved === "ar" || saved === "en") return saved;
  const browser = navigator.language || navigator.userLanguage || "en";
  return browser.startsWith("ar") ? "ar" : "en";
}

// ── Global lang state ──────────────────────────────────────
let currentLang = detectLang();

// ── Get a translated string ────────────────────────────────
function t(key) {
  return TRANSLATIONS[currentLang]?.[key]
      || TRANSLATIONS["en"]?.[key]
      || key;
}

// ── Switch language ────────────────────────────────────────
function setLang(lang) {
  if (!["en", "ar"].includes(lang)) return;
  currentLang = lang;
  localStorage.setItem("magizham_lang", lang);

  // Set RTL direction for Arabic
  document.documentElement.dir  = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = lang;

  // Re-render all elements with data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.innerText = t(key);
  });

  // Update toggle button
  const btn = document.getElementById("langToggle");
  if (btn) btn.innerText = lang === "ar" ? "EN" : "عربي";
}

// ── Toggle between en ↔ ar ─────────────────────────────────
function toggleLang() {
  setLang(currentLang === "en" ? "ar" : "en");
}

// ── Inject language toggle button into page ────────────────
function injectLangButton() {
  const btn = document.createElement("button");
  btn.id          = "langToggle";
  btn.onclick     = toggleLang;
  btn.innerText   = currentLang === "ar" ? "EN" : "عربي";
  btn.style.cssText = `
    position: fixed;
    top: 12px;
    ${currentLang === "ar" ? "left" : "right"}: 12px;
    z-index: 9000;
    background: #2d6a4f;
    color: white;
    border: none;
    border-radius: 20px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    font-family: "Nunito", sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(btn);
}

// ── Auto-init on DOM ready ─────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setLang(currentLang);   // apply RTL + translate data-i18n elements
  injectLangButton();     // show EN/عربي toggle button
});