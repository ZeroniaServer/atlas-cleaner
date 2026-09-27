const expander = document.querySelector(".text-expander");
const moreText = document.querySelector(".more-text");
const label = expander.querySelector(".label");
const panelTitle = document.getElementById("panelTitle");
const informationText = document.getElementById("informationText");
const changesTree = document.getElementById("changesTree");

function isChangesPanel() {
    return document.body.classList.contains("changes-mode");
}

function setExpanded(isOpen) {
    expander.classList.toggle("active", isOpen);
    moreText.classList.toggle("show", isOpen);
    label.textContent = isChangesPanel()
        ? (isOpen ? "Collapse" : "Expand")
        : (isOpen ? "Read less" : "Read more");
    expander.setAttribute("aria-expanded", isOpen);
}

expander.addEventListener("click", () => {
    setExpanded(!expander.classList.contains("active"));
});

window.activateChangesPanel = () => {
    document.body.classList.add("changes-mode");
    panelTitle.textContent = "Changes";
    informationText.classList.add("hidden");
    changesTree.classList.remove("hidden");
    setExpanded(false);
};
