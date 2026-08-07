(() => {
  const doc = document.documentElement;
  const nav = document.querySelector(".nav");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // sticky nav border
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // language
  const applyLang = (lang) => {
    doc.lang = lang === "en" ? "en" : "zh-CN";
    localStorage.setItem("apiniclaw-site-lang", lang);
    document.querySelectorAll(".lang-toggle button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.lang === lang);
    });
  };
  const saved = localStorage.getItem("apiniclaw-site-lang");
  applyLang(saved === "en" ? "en" : "zh");
  document.querySelectorAll(".lang-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => applyLang(btn.dataset.lang || "zh"));
  });

  // showcase tabs - only one screenshot visible, absolute stack
  const tabs = [...document.querySelectorAll(".tab-btn")];
  const shots = [...document.querySelectorAll(".screen-body img")];
  const showShot = (id) => {
    const key = id || "dashboard";
    tabs.forEach((t) => {
      const on = t.dataset.shot === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    shots.forEach((img) => {
      const on = img.dataset.shot === key;
      img.classList.toggle("is-visible", on);
      img.toggleAttribute("hidden", !on);
    });
  };
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => showShot(btn.dataset.shot || "dashboard"));
  });
  showShot(tabs[0]?.dataset.shot || "dashboard");

  // scroll reveal - generous rootMargin so lower sections appear early
  document.documentElement.classList.add("js-ready");
  const reveals = [...document.querySelectorAll(".reveal")];
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px 20% 0px" },
    );
    reveals.forEach((el) => io.observe(el));
    // fallback: force-show anything still hidden after 1.5s
    setTimeout(() => {
      reveals.forEach((el) => el.classList.add("is-in"));
    }, 1500);
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  // year
  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
