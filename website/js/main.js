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

  // showcase tabs
  const tabs = [...document.querySelectorAll(".tab-btn")];
  const shots = [...document.querySelectorAll(".screen-body img")];
  const showShot = (id) => {
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.shot === id));
    shots.forEach((img) => img.classList.toggle("is-visible", img.dataset.shot === id));
  };
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => showShot(btn.dataset.shot || "dashboard"));
  });
  if (tabs[0]) showShot(tabs[0].dataset.shot || "dashboard");

  // scroll reveal
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
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-in"));
  }

  // year
  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
