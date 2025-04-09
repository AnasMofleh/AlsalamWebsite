window.translations = window.translations || {};
window.translations.sv = {
    // Header
    header: {
        nav: {
            home: "Home",
            services: "Tjänster",
            donations: "Donationer",
            school: "Skolan",
            marriage: "Äktenskap",
            contact: "Kontakt",
            swish: "Swish: 1235942958"
        },
        langSwitcher: {
            sv: "SV",
            en: "EN",
            ar: "AR"
        }
    },
    // Footer
    footer: {
        addressLabel: "Adress",
        addressValue: "Södergatan 65, 252 25 Helsingborg",
        phoneLabel: "Telefonnummer",
        phoneValue: "+46 737395490",
        emailLabel: "e-postadress",
        emailValue: "alsalam.center@outlook.com",
        donationLabel: "Donation",
        donationSwish: "1235942958",
        donateButton: "Donera",
        copyright: "© alsalamcenter, All Right Reserved."
    },
    // Index Page
    index: {
        about: {
            title: "Om Oss",
            description: "Al Salam i Helsingborg är en islamisk förening och moksé. Ett center för muslimer att vända sig i alla aspekter av sitt liv, från bön och jummah till giftemål, kunskap, vägledning i sakfrågor i fiqh, till koranskola och arbaiska för barnen.",
            visionTitle: "Vår Vision",
            visionDescription: "muslimerna ska känna sig hemma i landet, kunna praktisera och utöva relgionen fullt ut som Svenska Muslimer."
        },
        values: {
            title: "Vår Värdegrund",
            knowledgeTitle: "Kunskap",
            knowledgeDescription: "En viktig del av varje muslims resa är sökandet av kunskap.",
            communityTitle: "Gemenskap",
            communityDescription: "Vi ber tillsammans, vi bryter vår fasta tillsammans, Islam ger en gemenskap.",
            prayerTitle: "Böner",
            prayerDescription: "Moskén är öppen för de 5 dagliga bönerna."
        },
        services: {
            title: "Tjänster",
            marriageTitle: "Äktenskapskontrakt",
            marriageDescription: "Nikah – Islamiskt äktenskapskontrakt utförs av Sheiykh Samir. Ni behöver boka en tid på förväg, vänligen skriv ett mail.",
            fatwaTitle: "Fatwaa",
            fatwaDescription: "Behöver det rådfråga gällande en islamisk fiqh fråga så kan ni kontakta oss via mejl.",
            fatwaLink: "mailto:alsalam.center@outlook.com", // Keep links separate if they don't change
            counselingTitle: "Familj rådgivning",
            counselingDescription: "Behövs det hjälp eller rådgivning i ett ärende eller en konflikt inom familj är ni välkomna att kontakta oss på vår mejl.",
            counselingLink: "mailto:alsalam.center@outlook.com",
            schoolTitle: "Koran och Arabiska skola",
            schoolDescription: "På helgerna finns det möjlighet för barnen att skrivas in i koran och arabiska skolan.",
            jummahTitle: "Jummah Predikan",
            jummahDescription: "Utför Predikan som hålls i moskén varje Jummah (fredag), börjar vid tiden för dhur bönen."
        }
    },
    // School Page (school.html)
    school: {
        formTitle: "Registreringsformulär",
        childLastNameLabel: "Barnets efternamn",
        childFirstNameLabel: "Barnets namn",
        childPersonnummerLabel: "Barnets personnummer",
        childPersonnummerTitle: "Personnummer måste vara 10 eller 12 siffror",
        registrationDateLabel: "Registreringsdatum",
        fatherNameLabel: "Pappans namn",
        motherNameLabel: "Mammans namn",
        fatherPersonnummerLabel: "Pappans personnummer",
        fatherPersonnummerTitle: "Personnummer måste vara 10 eller 12 siffror",
        motherPersonnummerLabel: "Mammans personnummer",
        motherPersonnummerTitle: "Personnummer måste vara 10 eller 12 siffror",
        fatherMobileLabel: "Pappans mobilnummer",
        fatherMobileTitle: "Mobilnummer måste börja med '07' och innehålla 10 siffror",
        motherMobileLabel: "Mammans mobilnummer",
        motherMobileTitle: "Mobilnummer måste börja med '07' och innehålla 10 siffror",
        fatherEmailLabel: "Pappans e-post",
        fatherEmailTitle: "Ange en giltig e-postadress",
        motherEmailLabel: "Mammans e-post",
        motherEmailTitle: "Ange en giltig e-postadress",
        contactParentLabel: "Vilken förälder ska vara kontaktpersonen:",
        contactParentFather: "Pappa",
        contactParentMother: "Mamma",
        schoolDayLabel: "Välj dag för skola (Lördag eller Söndag):",
        schoolDaySaturday: "Lördag",
        schoolDaySunday: "Söndag",
        submitButton: "Registrera",
        submissionError: "Submission failed. Please try again." // Added for the catch block
    },
    // School Success Page (school-success.html)
    schoolSuccess: {
        pageTitle: "Payment Success - School Portal",
        headerTitle: "School Portal",
        navHome: "Home",
        navContact: "Contact",
        successTitle: "Payment Successful!",
        successMessage: "Thank you for your payment. Below are the details you provided:",
        personnummerLabel: "Barnets personnummer:",
        loading: "Loading...",
        footerCopyright: "© 2025 School Portal. All Rights Reserved.",
        backLink: "Back to School Page"
    },
    // Marriage Page (marrige.html) - Assuming Jotform handles its internal labels
    marriage: {
        pageTitle: "Äktenskapsansökan",
        description: "Fyll i formuläret nedan för att ansöka om äktenskapsceremoni"
        // Note: The content inside the Jotform iframe needs to be translated within Jotform itself.
    },
    // Donations Page (donations.html)
    donations: {
        title: "Donationsalternativ",
        tabOneTime: "Engång",
        tabMonthly: "Månatlig",
        tabYearly: "Årlig",
        card1Title: "Sadaqa via Swish",
        card1Description: "Stödja moskén genom att swisha engångdonation \"sadaqa\".",
        card1Button: "Swisha", // Note: Swish action might need specific handling if it's not just text
        card2Title: "Sadaqa via andra betalningssätt",
        card2Description: "Stödja moskén genom att använda andra betalnings metoder.",
        // Stripe button text is controlled by Stripe
        card3Title: "Månatlig Sadaqa",
        card3Description: "Stödja moskén via automatisk återkommande sadaqa varje månad.",
        // Stripe button text is controlled by Stripe
        card4Title: "Sadaqa via Skattsedel",
        card4Description: "Stödja moskén genom att ge din moskéavgiften via skattsedel varje år.",
        card4Button: "Fyll i blanketten",
        popupTitle: "Information om Ansökan",
        popupIntro: "Innan du fyller i ansökan i nästa steg behöver du veta följande:",
        popupBullet1: "Lämna referensnummer fältet tom.",
        popupBullet2: "Checka INTE av boxen som säger att du vill ha 100% av din medlemsavigft går till FIFS.",
        popupBullet3: "Fyll i föreningsnamn som: Al Salam Center i Helsingborg",
        popupContinueButton: "Fortsätt till Ansökan"
    }
    // Add keys for other pages/components as needed
};