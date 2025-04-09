window.translations = window.translations || {};
window.translations.en = {
    // Header
    header: {
        nav: {
            home: "Home",
            services: "Services",
            donations: "Donations",
            school: "School",
            marriage: "Marriage",
            contact: "Contact",
            swish: "Swish: 1235942958" // Assuming Swish number stays the same
        },
        langSwitcher: {
            sv: "SV",
            en: "EN",
            ar: "AR"
        }
    },
    // Footer
    footer: {
        addressLabel: "Address",
        addressValue: "Södergatan 65, 252 25 Helsingborg", // Address usually stays the same
        phoneLabel: "Phone Number",
        phoneValue: "+46 737395490", // Phone usually stays the same
        emailLabel: "Email Address",
        emailValue: "alsalam.center@outlook.com", // Email usually stays the same
        donationLabel: "Donation",
        donationSwish: "1235942958", // Swish usually stays the same
        donateButton: "Donate",
        copyright: "© alsalamcenter, All Rights Reserved." // Check if name changes
    },
    // Index Page
    index: {
        about: {
            title: "About Us",
            description: "Al Salam in Helsingborg is an Islamic association and mosque. A center for Muslims to turn to in all aspects of their lives, from prayer and jummah to marriage, knowledge, guidance in fiqh matters, to Quran school and Arabic for children.",
            visionTitle: "Our Vision",
            visionDescription: "Muslims should feel at home in the country, be able to practice and exercise the religion fully as Swedish Muslims."
        },
        values: {
            title: "Our Values",
            knowledgeTitle: "Knowledge",
            knowledgeDescription: "An important part of every Muslim's journey is the pursuit of knowledge.",
            communityTitle: "Community",
            communityDescription: "We pray together, we break our fast together, Islam provides community.",
            prayerTitle: "Prayers",
            prayerDescription: "The mosque is open for the 5 daily prayers."
        },
        services: {
            title: "Services",
            marriageTitle: "Marriage Contract",
            marriageDescription: "Nikah – Islamic marriage contract performed by Sheikh Samir. You need to book an appointment in advance, please send an email.",
            fatwaTitle: "Fatwa",
            fatwaDescription: "If you need advice regarding an Islamic fiqh issue, you can contact us via email.",
            fatwaLink: "mailto:alsalam.center@outlook.com",
            counselingTitle: "Family Counseling",
            counselingDescription: "If help or advice is needed in a matter or conflict within the family, you are welcome to contact us via our email.",
            counselingLink: "mailto:alsalam.center@outlook.com",
            schoolTitle: "Quran and Arabic School",
            schoolDescription: "On weekends, children have the opportunity to enroll in the Quran and Arabic school.",
            jummahTitle: "Jummah Sermon",
            jummahDescription: "Performs the Sermon held at the mosque every Jummah (Friday), starting at the time of Dhuhr prayer."
        }
    },
     // School Page (school.html)
    school: {
        formTitle: "Registration Form",
        childLastNameLabel: "Child's Last Name",
        childFirstNameLabel: "Child's First Name",
        childPersonnummerLabel: "Child's Personal ID Number",
        childPersonnummerTitle: "Personal ID Number must be 10 or 12 digits",
        registrationDateLabel: "Registration Date",
        fatherNameLabel: "Father's Name",
        motherNameLabel: "Mother's Name",
        fatherPersonnummerLabel: "Father's Personal ID Number",
        fatherPersonnummerTitle: "Personal ID Number must be 10 or 12 digits",
        motherPersonnummerLabel: "Mother's Personal ID Number",
        motherPersonnummerTitle: "Personal ID Number must be 10 or 12 digits",
        fatherMobileLabel: "Father's Mobile Number",
        fatherMobileTitle: "Mobile number must start with '07' and contain 10 digits",
        motherMobileLabel: "Mother's Mobile Number",
        motherMobileTitle: "Mobile number must start with '07' and contain 10 digits",
        fatherEmailLabel: "Father's Email",
        fatherEmailTitle: "Enter a valid email address",
        motherEmailLabel: "Mother's Email",
        motherEmailTitle: "Enter a valid email address",
        contactParentLabel: "Which parent should be the contact person:",
        contactParentFather: "Father",
        contactParentMother: "Mother",
        schoolDayLabel: "Choose school day (Saturday or Sunday):",
        schoolDaySaturday: "Saturday",
        schoolDaySunday: "Sunday",
        submitButton: "Register",
        submissionError: "Submission failed. Please try again."
    },
    // School Success Page (school-success.html)
    schoolSuccess: {
        pageTitle: "Payment Success - School Portal",
        headerTitle: "School Portal",
        navHome: "Home",
        navContact: "Contact",
        successTitle: "Payment Successful!",
        successMessage: "Thank you for your payment. Below are the details you provided:",
        personnummerLabel: "Child's Personal ID Number:",
        loading: "Loading...",
        footerCopyright: "© 2025 School Portal. All Rights Reserved.",
        backLink: "Back to School Page"
    },
    // Marriage Page (marrige.html)
    marriage: {
        pageTitle: "Marriage Application",
        description: "Fill out the form below to apply for a marriage ceremony"
        // Jotform content needs translation within Jotform.
    },
    // Donations Page (donations.html)
    donations: {
        title: "Donation Options",
        tabOneTime: "One-Time",
        tabMonthly: "Monthly",
        tabYearly: "Yearly",
        card1Title: "Sadaqa via Swish",
        card1Description: "Support the mosque by making a one-time \"sadaqa\" donation via Swish.",
        card1Button: "Swish",
        card2Title: "Sadaqa via Other Payment Methods",
        card2Description: "Support the mosque using other payment methods.",
        card3Title: "Monthly Sadaqa",
        card3Description: "Support the mosque via automatic recurring sadaqa every month.",
        card4Title: "Sadaqa via Tax Form",
        card4Description: "Support the mosque by donating your mosque fee via the tax form each year.",
        card4Button: "Fill out the form",
        popupTitle: "Application Information",
        popupIntro: "Before you fill out the application in the next step, you need to know the following:",
        popupBullet1: "Leave the reference number field empty.",
        popupBullet2: "Do NOT check the box stating that you want 100% of your membership fee to go to FIFS.",
        popupBullet3: "Fill in the association name as: Al Salam Center i Helsingborg", // Keep name? Or translate?
        popupContinueButton: "Continue to Application"
    }
    // Add keys for other pages/components as needed
};