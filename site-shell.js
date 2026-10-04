(() => {
  const LANGUAGES = [
    ["en", "English"],
    ["hi", "हिन्दी — Hindi"],
    ["mr", "मराठी — Marathi"],
    ["gu", "ગુજરાતી — Gujarati"],
    ["ur", "اردو — Urdu"],
    ["ta", "தமிழ் — Tamil"],
    ["te", "తెలుగు — Telugu"],
    ["ml", "മലയാളം — Malayalam"],
    ["kn", "ಕನ್ನಡ — Kannada"],
    ["bn", "বাংলা — Bengali"],
    ["pa", "ਪੰਜਾਬੀ — Punjabi"],
    ["as", "অসমীয়া — Assamese"],
    ["or", "ଓଡ଼ିଆ — Odia"]
  ];

  const optionsHTML = () => LANGUAGES
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");

  function ensureTranslateContainer() {
    let container = document.getElementById("google_translate_element");

    if (!container) {
      container = document.createElement("div");
      container.id = "google_translate_element";
      document.body.appendChild(container);
    }

    return container;
  }

  function populateLanguageSelectors() {
    document.querySelectorAll("#languageSelect, .site-footer-language select").forEach((select) => {
      const currentValue = select.value || "en";
      select.innerHTML = optionsHTML();
      select.value = LANGUAGES.some(([value]) => value === currentValue) ? currentValue : "en";

      if (!select.dataset.siteLanguageBound) {
        select.addEventListener("change", () => window.siteChangeLanguage(select.value));
        select.dataset.siteLanguageBound = "true";
      }
    });
  }

  function mountGoogleTranslate(attempt = 0) {
    if (document.querySelector(".goog-te-combo")) {
      return;
    }

    if (window.google?.translate?.TranslateElement) {
      try {
        new window.google.translate.TranslateElement(
          {
            pageLanguage: "en",
            includedLanguages: LANGUAGES.map(([value]) => value).join(","),
            autoDisplay: false
          },
          "google_translate_element"
        );
      } catch (error) {
        console.warn("Translation widget could not be initialized.", error);
      }
      return;
    }

    if (attempt < 20) {
      window.setTimeout(() => mountGoogleTranslate(attempt + 1), 500);
    }
  }

  function loadGoogleTranslate() {
    ensureTranslateContainer();

    if (window.google?.translate?.TranslateElement) {
      mountGoogleTranslate();
      return;
    }

    const existingScript = document.querySelector(
      'script[src*="translate.google.com/translate_a/element.js"]'
    );

    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://translate.google.com/translate_a/element.js";
      script.async = true;
      script.onload = () => mountGoogleTranslate();
      document.head.appendChild(script);
    }

    mountGoogleTranslate();
  }

  window.siteChangeLanguage = (languageCode, attempt = 0) => {
    const googleDropdown = document.querySelector(".goog-te-combo");

    if (googleDropdown) {
      googleDropdown.value = languageCode;
      googleDropdown.dispatchEvent(new Event("change"));
      document.querySelectorAll("#languageSelect, .site-footer-language select").forEach((select) => {
        select.value = languageCode;
      });
      return;
    }

    if (attempt < 20) {
      window.setTimeout(() => window.siteChangeLanguage(languageCode, attempt + 1), 500);
    }
  };

  if (typeof window.changeLanguage !== "function") {
    window.changeLanguage = window.siteChangeLanguage;
  }

  function renderFooter() {
    let footer = document.querySelector("footer");

    if (!footer) {
      footer = document.createElement("footer");
      document.body.appendChild(footer);
    }

    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="site-footer-inner">
        <section class="site-footer-brand" aria-label="MediConnect information">
          <p class="site-footer-eyebrow">Verified care · health awareness · community support</p>
          <div class="site-footer-brand-row">
            <span class="site-footer-mark" aria-hidden="true">M</span>
            <strong>MediConnect</strong>
          </div>
          <p>Reliable health information, verified care connections and community initiatives—designed to help people take their next step with confidence.</p>
        </section>

        <section>
          <p class="site-footer-title">Explore</p>
          <nav class="site-footer-links" aria-label="Footer navigation">
            <a href="index.html">Home</a>
            <a href="doctors.html">Find Care</a>
            <a href="index.html#campaigns">Health Campaigns</a>
            <a href="vaccination.html">Vaccination Updates</a>
            <a href="chatbot.html">MediGuide</a>
            <a href="habits.html">Healthy Habits</a>
            <span id="site-footer-account-links"></span>
          </nav>
        </section>

        <section class="site-footer-language">
          <p class="site-footer-title">Language</p>
          <label for="footerLanguageSelect">Choose your preferred language</label>
          <select id="footerLanguageSelect" aria-label="Choose your preferred language">
            ${optionsHTML()}
          </select>
          <p class="site-footer-note">The page content will be translated using Google Translate.</p>
        </section>
      </div>

      <div class="site-footer-bottom">
        <span>© 2026 MediConnect. For general health awareness only.</span>
        <a class="site-footer-admin" href="login.html?redirect=admin-panel.html">Administrator access</a>
      </div>
    `;

    const footerSelect = document.getElementById("footerLanguageSelect");
    const headerSelect = document.getElementById("languageSelect");
    footerSelect.value = headerSelect?.value || "en";
    populateLanguageSelectors();
  }

  async function addAccountDashboardLink() {
    const container = document.getElementById("site-footer-account-links");
    if (!container) return;

    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      if (!response.ok) return;
      const user = await response.json();
      const dashboard = user.role === "doctor"
        ? ["doctor-dashboard.html", "Doctor workspace"]
        : user.role === "ngo"
          ? ["ngo-dashboard.html", "NGO workspace"]
          : ["", ""];
      if (dashboard[0]) {
        container.innerHTML = `<a href="${dashboard[0]}">${dashboard[1]}</a>`;
      }
    } catch (error) {
      // Public pages remain usable when authentication is unavailable.
    }
  }

  function initialize() {
    renderFooter();
    populateLanguageSelectors();
    loadGoogleTranslate();
    addAccountDashboardLink();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
