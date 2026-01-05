const DEFAULT_LANG = "sv";
let currentTranslations = null;


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

// load navbar and footer daynamically
async function loadHeader() {
  const res = await fetch("header.html");
  document.getElementById("header").innerHTML = await res.text();
}


// load i18n files and apply translations
export async function loadLanguage(lang = DEFAULT_LANG) {
  try {
    const response = await fetch(`i18n/${lang}.json`);
    if (!response.ok) throw new Error("Translation file not found");

    const translations = await response.json();
    currentTranslations = translations;

    document.querySelectorAll("[data-i18n]").forEach(el => {
      const value = resolveKey(translations, el.dataset.i18n);
      if (typeof value === "string") {
        setElementTextPreserveChildren(el, value);
      }
    });


    if (document.documentElement.lang !== lang) {
      document.documentElement.lang = lang;
    }

    const dir = lang === "ar" ? "rtl" : "ltr";
    if (document.documentElement.dir !== dir) {
      document.documentElement.dir = dir;
    }

    localStorage.setItem("lang", lang);
  } catch (err) {
    console.error("i18n error:", err);
  }
}


async function initApp() {
  await loadHeader();

  const savedLang = localStorage.getItem("lang") || DEFAULT_LANG;
  await loadLanguage(savedLang);
}

window.loadLanguage = loadLanguage;
document.addEventListener("DOMContentLoaded", initApp);
