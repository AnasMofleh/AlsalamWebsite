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

    // Also watch for dynamically injected spinners (from header.html loaded via .load())
    var spinnerWatch = setInterval(function () {
        var sp = document.getElementById('spinner');
        if (sp && sp.classList.contains('show')) {
            sp.classList.remove('show');
            clearInterval(spinnerWatch);
        }
    }, 300);
    // Stop watching after 5 seconds regardless
    setTimeout(function () { clearInterval(spinnerWatch); }, 5000);

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

    // ── Mobile navbar fix for dynamically loaded header ──
    var navInitInterval = setInterval(function () {
        var navbarCollapse = document.getElementById('navbarCollapse');
        if (!navbarCollapse) return;
        if (typeof bootstrap === 'undefined') return;
        clearInterval(navInitInterval);

        // Initialize Bootstrap Dropdowns inside navbar
        document.querySelectorAll('.navbar [data-bs-toggle="dropdown"]').forEach(function (el) {
            if (!bootstrap.Dropdown.getInstance(el)) {
                new bootstrap.Dropdown(el);
            }
        });

        // Auto-close mobile navbar when a non-dropdown link is tapped
        navbarCollapse.querySelectorAll('.nav-link:not(.dropdown-toggle)').forEach(function (link) {
            link.addEventListener('click', function () {
                var bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse);
                if (bsCollapse && navbarCollapse.classList.contains('show')) {
                    bsCollapse.hide();
                }
            });
        });
    }, 200);

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
    const SWISH_API_URL = "https://script.google.com/macros/s/AKfycbxLXBaGS2rdrrvtFAxMGCAeK2elGSfbvRmjtxBhjbORf9gdHBHduzOXIzP2FCI501cMWA/exec";
    const STRIPE_API_URL = "https://script.google.com/macros/s/AKfycby4xd1YkqdDe-xvshIuMpj53wCLM9kUClwb84Qtx5amrPd6xrUjKjJxiYSdEppweq4/exec";
    const $total = $("#stats-preview-total");
    const $progress = $("#stats-preview-progress");
    const $percentage = $("#stats-preview-percentage");
    const $milestoneLeft = $("#stats-preview-milestone-left");
    const $message = $("#stats-preview-message");
    const defaultStatsPreviewMessage = $message.text().trim();

    // Cache settings
    const statsPreviewCacheKey = "alsalam-stats-snapshot";
    const statsPreviewCacheTtl = 5 * 60 * 1000; // 5 minutes

    // --- Preview sync helpers ---
    function applyStatsPreview(snapshot) {
        if (!$total.length) return;

        const locale = "sv-SE";
        const totalAlltime = Number(snapshot.totalAmount ?? snapshot.total_alltime ?? snapshot.totalAlltime ?? 0);
        const latestMessage = snapshot.latestMessage ?? "";
        const latestTime = snapshot.latestTime ?? "";

        const targetGoal = Number(snapshot.goal ?? goal ?? 0);
        const pct = targetGoal > 0 ? Math.min((totalAlltime / targetGoal) * 100, 100) : 0;
        const nextMilestone = Math.min(Math.floor(totalAlltime / 1000000) + 1, 10);
        const nextMilestoneTarget = nextMilestone * 1000000;
        const leftToMilestone = Math.max(nextMilestoneTarget - totalAlltime, 0);

        $total.text(`${totalAlltime.toLocaleString(locale)} kr`);
        $progress.css("width", `${pct.toFixed(1)}%`);
        $percentage.text(`${pct.toFixed(1)}%`);
        if ($milestoneLeft.length) {
            $milestoneLeft.text(
                `Nästa milstolpe: ${nextMilestone} M • kvar ${leftToMilestone.toLocaleString(locale)} SEK`
            );
        }

        if (latestMessage) {
            const prefix = latestTime ? `Senaste ${latestTime}: ` : "Senaste: ";
            $message.text(`${prefix}"${latestMessage}"`).show();
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

    function formatPreviewTimeHHMM(timeValue) {
        if (!timeValue) return "";
        const text = String(timeValue).trim();
        const match = text.match(/(\d{1,2}):(\d{2})/);
        if (!match) return "";
        return `${match[1].padStart(2, "0")}:${match[2]}`;
    }

    function parseAmountValue(input) {
        if (typeof input === "number") return input;
        const text = String(input == null ? "" : input).trim();
        if (!text) return 0;
        const normalized = text.replace(/\s|\u00A0/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function parseStripeTotal(stripeRaw) {
        const payload = stripeRaw && stripeRaw.data ? stripeRaw.data : stripeRaw;
        if (!payload) return 0;

        if (Array.isArray(payload)) {
            return payload.reduce((sum, payment) => sum + parseAmountValue(payment.Amount ?? payment.amount ?? 0), 0);
        }

        return parseAmountValue(payload.total_stripe ?? payload.total_card ?? payload.totalAmount ?? 0);
    }

    function updateStatsPreview(swishRaw, stripeRaw) {
        if (!$total.length) return;
        const payload = (swishRaw && swishRaw.data) ? swishRaw.data : swishRaw;
        const last5 = Array.isArray(payload && payload.last5) ? payload.last5 : [];
        const latest = last5[0] || null;
        const swishTotal = Number(payload && (payload.totalAmount ?? payload.total_alltime) ? (payload.totalAmount ?? payload.total_alltime) : 0);
        const stripeTotal = parseStripeTotal(stripeRaw);
        const snapshot = {
            totalAmount: swishTotal + stripeTotal,
            latestMessage: latest && latest.message ? String(latest.message) : "",
            latestTime: latest && latest.time ? formatPreviewTimeHHMM(latest.time) : "",
            goal,
        };
        applyStatsPreview(snapshot);
        persistStatsPreview(snapshot);
    }

    async function fetchStatsPreview() {
        if (!$total.length) return;
        try {
            const [swishResponse, stripeResponse] = await Promise.allSettled([
                fetch(SWISH_API_URL),
                fetch(STRIPE_API_URL),
            ]);

            if (swishResponse.status !== "fulfilled" || !swishResponse.value.ok) {
                throw new Error("Swish stats request failed");
            }

            const swishData = await swishResponse.value.json();
            let stripeData = null;
            if (stripeResponse.status === "fulfilled" && stripeResponse.value.ok) {
                stripeData = await stripeResponse.value.json();
            }

            updateStatsPreview(swishData, stripeData);
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