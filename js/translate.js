(function() {
    "use strict";

    let currentLang = 'sv'; // Default language
    let currentLangData = {};

    // --- Helper Function to Get Nested Values ---
    function getKeyValue(obj, keyString) {
        if (!keyString) return null;
        const keys = keyString.split('.');
        let value = obj;
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                // console.warn(`Translation key "${keyString}" not found in language data.`);
                return null; // Key not found or path invalid
            }
        }
        return typeof value === 'string' ? value : null; // Only return if it's a string
    }

    // --- Function to Translate a Single Element ---
    function translateElement(element, langData) {
        const textKey = element.dataset.translate;
        const placeholderKey = element.dataset.translatePlaceholder;
        const titleKey = element.dataset.translateTitle;

        // Translate text content
        if (textKey) {
            const translation = getKeyValue(langData, textKey);
            if (translation !== null) {
                 // Basic check to avoid overwriting complex HTML structures within simple text elements
                 // This is NOT foolproof. If you have icons *and* text, manually adjust HTML or this logic.
                 if (element.children.length > 0 && element.childElementCount === element.children.length && !element.hasAttribute('data-translate-allow-html')) {
                    // Likely contains only other elements (like <i>), find the main text node if any
                    let textNodeFound = false;
                    for(let i = 0; i < element.childNodes.length; i++){
                        if(element.childNodes[i].nodeType === Node.TEXT_NODE && element.childNodes[i].nodeValue.trim() !== ''){
                            element.childNodes[i].nodeValue = translation;
                            textNodeFound = true;
                            break;
                        }
                    }
                    // If no text node, maybe it's a button label etc. - carefully consider if it should be updated.
                     // if (!textNodeFound) console.log("Element with children has data-translate but no direct text node:", element);

                 } else {
                     // Simple text or element allows innerHTML update
                     element.innerHTML = translation; // Use innerHTML to allow © etc.
                 }
            } else {
                 element.innerHTML = textKey || ''; // Show key if translation missing
            }
        }

        // Translate placeholder
        if (placeholderKey && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
            const translation = getKeyValue(langData, placeholderKey);
            if (translation !== null) {
                element.placeholder = translation;
            } else {
                element.placeholder = placeholderKey;
            }
        }

        // Translate title
        if (titleKey) {
            const translation = getKeyValue(langData, titleKey);
            if (translation !== null) {
                element.title = translation;
            } else {
                 element.title = titleKey;
            }
        }
    }

    // --- Main Function to Translate the Entire Page ---
    window.translatePage = function(lang) {
        if (!window.translations || !window.translations[lang]) {
            console.error(`Translations for language "${lang}" not loaded.`);
            return;
        }

        currentLang = lang;
        currentLangData = window.translations[lang];

        // Set HTML lang and dir
        document.documentElement.lang = lang;
        if (lang === 'ar') {
            document.documentElement.dir = 'rtl';
            document.body.classList.add('arabic-lang');
            document.body.classList.remove('swedish-lang', 'english-lang');
        } else {
            document.documentElement.dir = 'ltr';
            document.body.classList.remove('arabic-lang');
            document.body.classList.add(lang === 'sv' ? 'swedish-lang' : 'english-lang');
            document.body.classList.remove(lang === 'sv' ? 'english-lang' : 'swedish-lang');
        }

        // Translate all elements with data-translate attributes
        const elements = document.querySelectorAll('[data-translate], [data-translate-placeholder], [data-translate-title]');
        elements.forEach(el => translateElement(el, currentLangData));

        // Update active button style (ensure switcher exists)
        const switcher = document.querySelector('.language-switcher');
        if (switcher) {
            switcher.querySelectorAll('button').forEach(button => {
                const buttonLang = button.dataset.lang;
                if (buttonLang === lang) {
                    button.classList.add('active', 'btn-primary'); // Use Bootstrap's 'active' or a custom class
                    button.classList.remove('btn-outline-secondary');
                } else {
                    button.classList.remove('active', 'btn-primary');
                    button.classList.add('btn-outline-secondary');
                }
                 // Optionally translate the button text itself if needed (SV/EN/AR)
                 const buttonTextKey = `header.langSwitcher.${buttonLang}`;
                 const buttonText = getKeyValue(currentLangData, buttonTextKey);
                 if(buttonText) button.textContent = buttonText;
            });
        }

        // Save selected language
        try {
             localStorage.setItem('selectedLanguage', lang);
        } catch (e) {
            console.warn("Could not save language preference to localStorage:", e);
        }

        // Dispatch a custom event to notify other scripts (like $.load callbacks)
        document.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: lang } }));
    }

    // --- Initialize Language Switcher ---
     window.initializeLanguageSwitcher = function() {
        const switcher = document.querySelector('.language-switcher');
        if (switcher && !switcher.hasAttribute('data-listener-attached')) { // Prevent adding multiple listeners
            switcher.addEventListener('click', (event) => {
                if (event.target.tagName === 'BUTTON' && event.target.dataset.lang) {
                    const newLang = event.target.dataset.lang;
                    if (newLang !== currentLang) {
                         translatePage(newLang);
                    }
                }
            });
            switcher.setAttribute('data-listener-attached', 'true'); // Mark as initialized
        }
    }

    // --- Initial Load ---
    document.addEventListener('DOMContentLoaded', () => {
        // Check if translation objects are loaded
        if (!window.translations || !window.translations.sv || !window.translations.en || !window.translations.ar) {
             console.error("One or more translation files failed to load or are missing.");
             // Optional: Display an error message to the user on the page
             // document.body.innerHTML = "Error loading website translations. Please try again later.";
             return;
        }

        let preferredLang = 'sv'; // Default
        try {
            preferredLang = localStorage.getItem('selectedLanguage') || 'sv';
        } catch (e) {
            console.warn("Could not read language preference from localStorage:", e);
        }


        // Ensure the preferred language exists before applying
        if (!window.translations[preferredLang]) {
             console.warn(`Saved language "${preferredLang}" is not available. Defaulting to 'sv'.`);
             preferredLang = 'sv';
        }

        translatePage(preferredLang); // Apply initial language
        initializeLanguageSwitcher(); // Initialize switcher on initial load
    });

})(); // IIFE to avoid polluting global scope unnecessarily