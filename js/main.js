(function ($) {
    "use strict";

    // Spinner
    var spinner = function () {
        setTimeout(function () {
            if ($("#spinner").length > 0) {
                $("#spinner").removeClass("show");
            }
        }, 1);
    };
    spinner(0);

    // Initiate the wowjs
    new WOW().init();

    // Back to top button
    $(window).scroll(function () {
        if ($(this).scrollTop() > 300) {
            $(".back-to-top").fadeIn("slow");
        } else {
            $(".back-to-top").fadeOut("slow");
        }
    });
    $(".back-to-top").click(function () {
        $("html, body").animate({ scrollTop: 0 }, 1500, "easeInOutExpo");
        return false;
    });

    // Navbar dropdown (desktop): prevent flicker/un-clickable menu
    // Uses event delegation so it works even if `header.html` is injected dynamically.
    function isDesktopNavbar() {
        return window.matchMedia && window.matchMedia("(min-width: 992px)").matches;
    }

    function closeDesktopDropdowns() {
        const $open = $(".navbar .nav-item.dropdown.open");
        if (!$open.length) return;
        $open.removeClass("open");
        $open.children(".nav-link.dropdown-toggle").attr("aria-expanded", "false");
    }

    $(document).on("click", ".navbar .nav-item.dropdown > .nav-link.dropdown-toggle", function (e) {
        if (!isDesktopNavbar()) return;

        // If this dropdown is managed by Bootstrap (data-bs-toggle), let Bootstrap handle it.
        const $toggle = $(this);
        if ($toggle.is("[data-bs-toggle='dropdown'], [data-toggle='dropdown']")) return;

        e.preventDefault();
        e.stopPropagation();

        const $dropdown = $toggle.closest(".nav-item.dropdown");

        // Close other open dropdowns first
        $(".navbar .nav-item.dropdown.open").not($dropdown).removeClass("open")
            .children(".nav-link.dropdown-toggle").attr("aria-expanded", "false");

        $dropdown.toggleClass("open");
        $toggle.attr("aria-expanded", $dropdown.hasClass("open") ? "true" : "false");
    });

    // Clicking inside the menu shouldn't close it before a link activates.
    $(document).on("click", ".navbar .nav-item.dropdown .dropdown-menu", function (e) {
        if (!isDesktopNavbar()) return;
        e.stopPropagation();
    });

    // Close when clicking elsewhere (desktop)
    $(document).on("click", function () {
        if (!isDesktopNavbar()) return;
        closeDesktopDropdowns();
    });

    // If you resize to mobile, clear any open desktop state.
    $(window).on("resize", function () {
        if (isDesktopNavbar()) return;
        closeDesktopDropdowns();
    });

    // Testimonial carousel
    $(".testimonial-carousel").owlCarousel({
        autoplay: true,
        smartSpeed: 1500,
        dots: false,
        loop: true,
        margin: 25,
        nav: true,
        navText: ['<i class="bi bi-arrow-left"></i>', '<i class="bi bi-arrow-right"></i>'],
        responsive: {
            0: { items: 1 },
            768: { items: 1 },
            992: { items: 2 },
            1200: { items: 3 },
        },
    });

    const goal = 10000000;
    const $total = $("#stats-preview-total");
    const $count = $("#stats-preview-count");
    const $top = $("#stats-preview-top");
    const $progress = $("#stats-preview-progress");
    const $percentage = $("#stats-preview-percentage");
    const $message = $("#stats-preview-message");
    const defaultStatsPreviewMessage = $message.text().trim();

    // Cache settings
    const statsPreviewCacheKey = "alsalam-stats-snapshot";
    const statsPreviewCacheTtl = 5 * 60 * 1000; // 5 minutes

    // --- Preview sync helpers ---
    function applyStatsPreview(snapshot) {
        if (!$total.length) return;

        const locale = "sv-SE";
        const totalAlltime = Number(snapshot.total_alltime ?? snapshot.totalAlltime ?? 0);
        const countToday = Number(snapshot.count_today ?? snapshot.countToday ?? 0);
        const highestTodayAmountSource =
            snapshot.highest_today_amount ??
            snapshot.highestTodayAmount ??
            (snapshot.Highest_today && snapshot.Highest_today.amount) ??
            0;
        const highestTodayAmount = Number(highestTodayAmountSource);
        const highestTodayMessage =
            snapshot.highest_today_message ??
            (snapshot.Highest_today && snapshot.Highest_today.message) ??
            snapshot.highestTodayMessage ??
            "";

        const targetGoal = Number(snapshot.goal ?? goal ?? 0);
        const pct = targetGoal > 0 ? Math.min((totalAlltime / targetGoal) * 100, 100) : 0;

        $total.text(`${totalAlltime.toLocaleString(locale)} kr`);
        $count.text(`${countToday.toLocaleString(locale)}+`);
        $top.text(`${highestTodayAmount.toLocaleString(locale)} kr`);
        $progress.css("width", `${pct.toFixed(1)}%`);
        $percentage.text(`${pct.toFixed(1)}%`);

        if (highestTodayMessage) {
            $message.text(`"${highestTodayMessage}"`).show();
        } else if (defaultStatsPreviewMessage) {
            $message.text(defaultStatsPreviewMessage).show();
        } else {
            $message.text("").hide();
        }
    }

    function hydrateStatsPreviewFromCache() {
        if (!$total.length) return;
        try {
            const cached = localStorage.getItem(statsPreviewCacheKey);
            if (!cached) return;
            const snapshot = JSON.parse(cached);
            if (!snapshot || !snapshot.updated_at) return;
            if (Date.now() - snapshot.updated_at > statsPreviewCacheTtl) return;
            applyStatsPreview(snapshot);
        } catch (error) {
            console.warn("Stats preview cache unavailable", error);
        }
    }

    function persistStatsPreview(snapshot) {
        try {
            localStorage.setItem(
                statsPreviewCacheKey,
                JSON.stringify(Object.assign({}, snapshot, { updated_at: Date.now() }))
            );
        } catch (error) {
            console.warn("Stats preview cache skipped", error);
        }
    }

    function updateStatsPreview(data) {
        if (!$total.length) return;
        const snapshot = {
            total_alltime: data.total_alltime,
            total_today: data.total_today,
            count_today: data.count_today,
            highest_today_amount: data.Highest_today ? data.Highest_today.amount : 0,
            highest_today_message: data.Highest_today ? (data.Highest_today.message || "") : "",
            goal,
        };
        applyStatsPreview(snapshot);
        persistStatsPreview(snapshot);
    }

    async function fetchStatsPreview() {
        if (!$total.length) return;
        try {
            const response = await fetch("https://script.google.com/macros/s/AKfycbyvsHmRWM96nR0xMFjUk1y0ox_Pohm0Rtd8MIfZYvvpevjokVmY-eU8ZIHZfN-tdUi8/exec");
            if (!response.ok) throw new Error(`Stats request failed with status ${response.status}`);
            const data = await response.json();
            updateStatsPreview(data);
        } catch (fetchError) {
            console.warn("Stats preview fetch failed", fetchError);
        }
    }

    // Init preview on pages that include the preview placeholders
    if ($total.length) {
        hydrateStatsPreviewFromCache();
        fetchStatsPreview();
        setInterval(fetchStatsPreview, 15000);
    }
})(jQuery);