let selectedFile;
let cleanedBlob;

const normalizePath = (p) => p.replace(/\\/g, "/");

function findWorldRoot(entries) {
    const levelDatPaths = entries
        .filter(([, entry]) => !entry.dir)
        .map(([path]) => normalizePath(path))
        .filter((path) => path === "level.dat" || path.endsWith("/level.dat"));

    if (levelDatPaths.length !== 1) return "";

    const levelDatPath = levelDatPaths[0];
    return levelDatPath === "level.dat"
        ? ""
        : levelDatPath.slice(0, -"level.dat".length);
}

const uploadUI = document.getElementById("uploadUI");
const fileName = document.getElementById("fileName");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const downloadBtn = document.getElementById("downloadBtn");
const fileButton = document.getElementById("fileButton");
const convertAgainBtn = document.getElementById("convertAgainBtn");

const foldersToDelete = [
    "advancements/",
    "playerdata/",
    "players/",
    "stats/",
    "generated/",
    /^(?:poi|dimensions\/(?:[^/]+\/)+poi)\//
];

const foldersToClean = [
    /^(entities|poi|region)\//,
    /^dimensions\/[^/]+\/[^/]+\/(entities|poi)\//,
    /^dimensions\/(?:[^/]+\/)+region\//
];

// ---------------- UPLOAD ----------------

fileButton.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    handleFile(fileInput.files[0]);
});

// ---------------- DRAG & DROP ----------------

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    handleFile(e.dataTransfer.files[0]);
});

// ---------------- CORE PIPELINE ----------------

async function handleFile(file) {
    if (!file) return;

    selectedFile = file;
    const downloadName = file.name.replace(/\.zip$/i, "");

    fileName.textContent = file.name;

    uploadUI.classList.add("hidden");
    downloadBtn.classList.remove("hidden");
    downloadBtn.textContent = "Processing...";

    const zip = await JSZip.loadAsync(file);
    const newZip = new JSZip();

    const entries = Object.entries(zip.files);
    const worldRoot = findWorldRoot(entries);

    for (const [path, entry] of entries) {

        const normalizedPath = normalizePath(path);
        if (worldRoot && !normalizedPath.startsWith(worldRoot)) continue;

        const worldPath = normalizedPath.slice(worldRoot.length);

        if (foldersToDelete.some(f => {
            if (typeof f === "string") {
                return worldPath.startsWith(f);
            }
            return f.test(worldPath);
        })) {
            continue;
        }

        if (entry.dir) continue;

        const content = await entry.async("uint8array");

        const isInCleanFolder = foldersToClean.some(f => {
            if (typeof f === "string") {
                return worldPath.startsWith(f);
            }
            return f.test(worldPath);
        });

        if (isInCleanFolder && content.length === 0) {
            continue;
        }

        newZip.file(worldPath, content);
    }

    cleanedBlob = await newZip.generateAsync({
        type: "blob",
        compression: "DEFLATE"
    });

    downloadBtn.textContent = "Download";
    convertAgainBtn.classList.remove("hidden");
}

// ---------------- DOWNLOAD ----------------

downloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    if (!cleanedBlob) {
        alert("The file isn't ready yet!");
        return;
    }

    const url = URL.createObjectURL(cleanedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedFile.name.replace(/\.zip$/i, "")}-cleaned.zip`;
    a.click();
    URL.revokeObjectURL(url);
});

// ---------------- RESET ----------------

convertAgainBtn.addEventListener("click", () => {
    selectedFile = null;
    cleanedBlob = null;
    fileInput.value = "";

    fileName.textContent = "";
    uploadUI.classList.remove("hidden");

    downloadBtn.classList.add("hidden");
    convertAgainBtn.classList.add("hidden");

    downloadBtn.textContent = "Download";
});
