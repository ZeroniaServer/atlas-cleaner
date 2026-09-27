let selectedFile;
let cleanedBlob;
let pendingZip;
let pendingEntries;
let pendingWorldRoot;
let pendingDimensions;
let pendingDatapacks;
let pendingSelectedDimensions = new Set();

const dimensionSelectionKey = "atlas-cleaner-selected-dimensions";
const datapackSelectionKey = "atlas-cleaner-selected-datapacks";
const dimensionStorageFolders = new Set([
    "advancements",
    "data",
    "entities",
    "generated",
    "poi",
    "playerdata",
    "region",
    "stats"
]);

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
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const downloadBtn = document.getElementById("downloadBtn");
const fileButton = document.getElementById("fileButton");
const convertAgainBtn = document.getElementById("convertAgainBtn");
const dimensionUI = document.getElementById("dimensionUI");
const dimensionList = document.getElementById("dimensionList");
const dimensionNextBtn = document.getElementById("dimensionNextBtn");
const datapackUI = document.getElementById("datapackUI");
const datapackList = document.getElementById("datapackList");
const datapackNextBtn = document.getElementById("datapackNextBtn");

const foldersToDelete = [
    "advancements/",
    "playerdata/",
    "players/",
    "stats/",
    "generated/",
    /^data\/minecraft\/scoreboard\.dat$/,
    /^(?:level\.dat_old|session\.lock)$/,
    /^(?:poi|dimensions\/(?:[^/]+\/)+poi)\//,
    /(?:^|\/)\.[^/]+(?:\/|$)/,
    /\.(?:md|py)$/i,
    /(?:^|\/)(?!license\.txt$)[^/]+\.txt$/i
];

const foldersToClean = [
    /^(entities|poi|region)\//,
    /^dimensions\/[^/]+\/[^/]+\/(entities|poi)\//,
    /^dimensions\/(?:[^/]+\/)+region\//
];

// ---------------- SELECTION FORMS ----------------

function findDimensions(entries, worldRoot) {
    const dimensionPaths = new Set();

    for (const [path] of entries) {
        const normalizedPath = normalizePath(path);
        if (worldRoot && !normalizedPath.startsWith(worldRoot)) continue;

        const worldPath = normalizedPath.slice(worldRoot.length);
        const parts = worldPath.split("/");
        if (parts[0] !== "dimensions" || parts.length < 4) continue;

        const storageIndex = parts.findLastIndex((part, index) =>
            index >= 3 && dimensionStorageFolders.has(part)
        );
        if (storageIndex < 3) continue;

        dimensionPaths.add(`${parts.slice(0, storageIndex).join("/")}/`);
    }

    return [...dimensionPaths].sort((a, b) => a.localeCompare(b));
}

function findDatapacks(entries, worldRoot) {
    const datapackPaths = new Set();

    for (const [path] of entries) {
        const normalizedPath = normalizePath(path);
        if (worldRoot && !normalizedPath.startsWith(worldRoot)) continue;

        const worldPath = normalizedPath.slice(worldRoot.length);
        const parts = worldPath.split("/");
        if (parts[0] !== "datapacks" || parts[parts.length - 1] !== "pack.mcmeta") continue;

        const datapackParts = parts.slice(1, -1);
        if (!datapackParts.length || datapackParts.some(part => part.startsWith("."))) continue;

        datapackPaths.add(`${parts.slice(0, -1).join("/")}/`);
    }

    return [...datapackPaths].sort((a, b) => a.localeCompare(b));
}

function readSelectedItems(selectionKey) {
    try {
        const stored = JSON.parse(localStorage.getItem(selectionKey));
        return new Set(Array.isArray(stored) ? stored : []);
    } catch {
        return new Set();
    }
}

function saveSelectedItems(selectionKey, selectedItems) {
    try {
        localStorage.setItem(
            selectionKey,
            JSON.stringify([...selectedItems])
        );
    } catch {
        return;
    }
}

function dimensionLabel(dimensionPath) {
    const parts = dimensionPath.split("/");
    return `${parts[1]}:${parts.slice(2, -1).join("/")}`;
}

function updateSelectionRow(row, input) {
    row.classList.toggle("selected", input.checked);
}

function showSelectionSelector(list, ui, items, selectionKey, labelFor) {
    const rememberedItems = readSelectedItems(selectionKey);
    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    list.innerHTML = "";

    for (const item of items) {
        const row = document.createElement("label");
        const input = document.createElement("input");
        const checkbox = document.createElement("span");
        const name = document.createElement("span");
        const trash = document.createElement("img");

        row.className = "selection-row";
        row.dataset.selectionPath = item;
        input.type = "checkbox";
        input.checked = rememberedItems.has(item);
        checkbox.className = "selection-checkbox";
        name.className = "selection-name";
        name.textContent = labelFor(item);
        trash.classList.add("selection-trash");
        trash.src = "./assets/imgs/trash.png";
        trash.alt = "";

        input.addEventListener("change", () => updateSelectionRow(row, input));
        updateSelectionRow(row, input);
        checkbox.append(trash);
        row.append(input, checkbox, name);
        list.append(row);
    }

    ui.classList.remove("hidden");
    dropZone.classList.add("dimension-mode");
}

function selectedItemsFromUI(list) {
    return new Set(
        [...list.querySelectorAll("input:checked")]
            .map(input => input.closest(".selection-row").dataset.selectionPath)
    );
}

function datapackLabel(datapackPath) {
    return datapackPath.split("/").slice(1, -1).join("/");
}

// ---------------- UPLOAD ----------------

fileButton.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    handleFile(fileInput.files[0]);
});

dimensionNextBtn.addEventListener("click", () => {
    pendingSelectedDimensions = selectedItemsFromUI(dimensionList);
    saveSelectedItems(dimensionSelectionKey, pendingSelectedDimensions);
    showDatapackSelectorOrProcess();
});

datapackNextBtn.addEventListener("click", () => {
    const selectedDatapacks = selectedItemsFromUI(datapackList);
    saveSelectedItems(datapackSelectionKey, selectedDatapacks);
    startProcessing(pendingSelectedDimensions, selectedDatapacks);
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
    uploadUI.classList.add("hidden");
    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    downloadBtn.classList.add("hidden");
    convertAgainBtn.classList.add("hidden");

    pendingZip = await JSZip.loadAsync(file);
    pendingEntries = Object.entries(pendingZip.files);
    pendingWorldRoot = findWorldRoot(pendingEntries);

    pendingDimensions = findDimensions(pendingEntries, pendingWorldRoot);
    pendingDatapacks = findDatapacks(pendingEntries, pendingWorldRoot);
    pendingSelectedDimensions = new Set();

    if (pendingDimensions.length > 1) {
        showSelectionSelector(
            dimensionList,
            dimensionUI,
            pendingDimensions,
            dimensionSelectionKey,
            dimensionLabel
        );
        return;
    }

    showDatapackSelectorOrProcess();
}

function showDatapackSelectorOrProcess() {
    if (pendingDatapacks.length > 1) {
        showSelectionSelector(
            datapackList,
            datapackUI,
            pendingDatapacks,
            datapackSelectionKey,
            datapackLabel
        );
        return;
    }

    startProcessing(pendingSelectedDimensions, new Set());
}

async function startProcessing(selectedDimensions, selectedDatapacks) {
    if (!pendingZip || !pendingEntries) return;

    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    dropZone.classList.remove("dimension-mode");
    downloadBtn.classList.remove("hidden");
    downloadBtn.textContent = "Processing...";

    const newZip = new JSZip();

    for (const [path, entry] of pendingEntries) {

        const normalizedPath = normalizePath(path);
        if (pendingWorldRoot && !normalizedPath.startsWith(pendingWorldRoot)) continue;

        const worldPath = normalizedPath.slice(pendingWorldRoot.length);

        if ([...selectedDimensions].some(dimensionPath => worldPath.startsWith(dimensionPath))) {
            continue;
        }

        if ([...selectedDatapacks].some(datapackPath => worldPath.startsWith(datapackPath))) {
            continue;
        }

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
    pendingZip = null;
    pendingEntries = null;
    pendingWorldRoot = null;
    pendingDimensions = null;
    pendingDatapacks = null;
    pendingSelectedDimensions = new Set();
    fileInput.value = "";

    uploadUI.classList.remove("hidden");
    dimensionUI.classList.add("hidden");
    dimensionList.innerHTML = "";
    datapackUI.classList.add("hidden");
    datapackList.innerHTML = "";
    dropZone.classList.remove("dimension-mode");

    downloadBtn.classList.add("hidden");
    convertAgainBtn.classList.add("hidden");

    downloadBtn.textContent = "Download";
});
