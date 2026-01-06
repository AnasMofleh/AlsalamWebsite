const DEFAULT_LANG = "sv";
let currentTranslations = null;
let currentLang = DEFAULT_LANG;


// access to nested keys in the translations object
function resolveKey(translations, key) {
  return key.split('.').reduce((obj, part) => obj?.[part], translations);
}


// safe text replacement while preserving child elements
function setElementTextPreserveChildren(el, text) {
  const hasElementChildren = Array.from(el.childNodes)
    .some(n => n.nodeType === Node.ELEMENT_NODE);

  if (hasElementChildren) {
    const textNode = Array.from(el.childNodes)
      .find(n => n.nodeType === Node.TEXT_NODE);

    if (textNode) {
      textNode.nodeValue = text ? ` ${text}` : '';
    } else if (text) {
      el.appendChild(document.createTextNode(` ${text}`));
    }
  } else {
    el.textContent = text;
  }
}

// Update language selector dropdown to show current language
function updateLanguageSelector(lang) {
  const selector = document.querySelector('select[onchange*="loadLanguage"]');
  if (selector) {
    selector.value = lang;
  }
}

// load i18n files and apply translations
export async function loadLanguage(lang = DEFAULT_LANG) {
  try {
    const response = await fetch(`i18n/${lang}.json`);
    if (!response.ok) throw new Error("Translation file not found");

    const translations = await response.json();
    currentTranslations = translations;
    currentLang = lang;

    // Apply translations to all elements with data-i18n attribute
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const value = resolveKey(translations, el.dataset.i18n);
      if (typeof value === "string") {
        setElementTextPreserveChildren(el, value);
      }
    });

    // Update language selector dropdown
    updateLanguageSelector(lang);

    // Update document language and direction
    if (document.documentElement.lang !== lang) {
      document.documentElement.lang = lang;
    }

    const dir = lang === "ar" ? "rtl" : "ltr";
    if (document.documentElement.dir !== dir) {
      document.documentElement.dir = dir;
    }

    // Save to localStorage
    localStorage.setItem("lang", lang);
  } catch (err) {
    console.error("i18n error:", err);
  }
}

// Function to reapply translations after header/footer are loaded
function reapplyTranslations() {
  if (currentTranslations && currentLang) {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const value = resolveKey(currentTranslations, el.dataset.i18n);
      if (typeof value === "string") {
        setElementTextPreserveChildren(el, value);
      }
    });
    updateLanguageSelector(currentLang);
  }
}

// Initialize the app
async function initApp() {
  const savedLang = localStorage.getItem("lang") || DEFAULT_LANG;
  await loadLanguage(savedLang);
  
  // Wait for header and footer to load, then reapply translations
  // This handles the case where header/footer are loaded via jQuery .load()
  const checkAndReapply = () => {
    const headerPlaceholder = document.getElementById("header-placeholder");
    const footerPlaceholder = document.getElementById("footer-placeholder");
    
    // Check if header and footer are loaded (they should have content)
    if (headerPlaceholder && footerPlaceholder) {
      const headerLoaded = headerPlaceholder.children.length > 0 || headerPlaceholder.innerHTML.trim() !== '';
      const footerLoaded = footerPlaceholder.children.length > 0 || footerPlaceholder.innerHTML.trim() !== '';
      
      if (headerLoaded && footerLoaded) {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          reapplyTranslations();
        }, 100);
        return true;
      }
    }
    return false;
  };

  // Try immediately
  if (!checkAndReapply()) {
    // If not loaded yet, check periodically
    const interval = setInterval(() => {
      if (checkAndReapply()) {
        clearInterval(interval);
      }
    }, 100);
    
    // Stop checking after 5 seconds to avoid infinite loop
    setTimeout(() => clearInterval(interval), 5000);
  }
}

window.loadLanguage = loadLanguage;
window.reapplyTranslations = reapplyTranslations;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
