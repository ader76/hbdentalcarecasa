const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");

if (menuToggle && nav) {
  menuToggle.addEventListener("click", () => {
    nav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", nav.classList.contains("open"));
  });
}

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

document.querySelectorAll(".reveal").forEach((item) => observer.observe(item));

const appointmentForm = document.querySelector("#appointmentForm");

if (appointmentForm) {
  appointmentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(appointmentForm);
    const name = data.get("name")?.toString().trim();
    const phone = data.get("phone")?.toString().trim();
    const reason = data.get("reason")?.toString().trim();
    const message = data.get("message")?.toString().trim();

    const text = [
      "Bonjour Dr Bouaamri, je souhaite contacter le cabinet.",
      "",
      `Nom : ${name}`,
      `Téléphone : ${phone}`,
      `Motif : ${reason}`,
      message ? `Message : ${message}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    window.open(`https://wa.me/212671300300?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  });
}
