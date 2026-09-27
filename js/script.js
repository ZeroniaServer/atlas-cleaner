let selectedFile;
let cleanedBlob;
let downloadFileName = "Filename.zip";
let pendingZip;
let pendingEntries;
let pendingWorldRoot;
let pendingDimensions;
let pendingDatapacks;
let pendingSelectedDimensions = new Set();
let pendingCleanWorldZip;

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

function defaultDownloadName(fileName) {
    return `${fileName.replace(/\.zip$/i, "")}-cleaned.zip`;
}

function sanitizeDownloadName(name) {
    const cleanedName = name
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
    const fallbackName = selectedFile ? defaultDownloadName(selectedFile.name) : "Filename.zip";
    const safeName = cleanedName || fallbackName;
    return /\.zip$/i.test(safeName) ? safeName : `${safeName}.zip`;
}

function beginDownloadNameEdit() {
    const input = document.createElement("input");
    input.className = "download-filename-input";
    input.type = "text";
    input.value = downloadFileName;
    const buttonWidth = downloadBtn.getBoundingClientRect().width;
    const filenameWidth = downloadFilename.getBoundingClientRect().width;
    downloadBtn.style.minWidth = `${buttonWidth}px`;
    input.style.width = `${filenameWidth}px`;
    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") input.blur();
        if (event.key === "Escape") {
            input.value = downloadFileName;
            input.blur();
        }
    });
    input.addEventListener("blur", () => {
        downloadFileName = sanitizeDownloadName(input.value);
        downloadFilename.textContent = downloadFileName;
        downloadBtn.style.minWidth = "";
        input.replaceWith(downloadFilename);
    }, { once: true });

    downloadFilename.replaceWith(input);
    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

function findArchiveRoot(entries, rootFileName) {
    const rootPaths = entries
        .filter(([, entry]) => !entry.dir)
        .map(([path]) => normalizePath(path))
        .filter((path) => path === rootFileName || path.endsWith(`/${rootFileName}`));

    if (rootPaths.length !== 1) return "";

    const rootPath = rootPaths[0];
    return rootPath === rootFileName
        ? ""
        : rootPath.slice(0, -rootFileName.length);
}

function findWorldRoot(entries) {
    return findArchiveRoot(entries, "level.dat");
}

function findResourceRoot(entries) {
    return findArchiveRoot(entries, "pack.mcmeta");
}

const uploadUI = document.getElementById("uploadUI");
const loadingUI = document.getElementById("loadingUI");
const loadingText = document.getElementById("loadingText");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const downloadBtn = document.getElementById("downloadBtn");
const downloadFilename = document.getElementById("downloadFilename");
const fileButton = document.getElementById("fileButton");
const convertAgainBtn = document.getElementById("convertAgainBtn");
const dimensionUI = document.getElementById("dimensionUI");
const dimensionList = document.getElementById("dimensionList");
const dimensionNextBtn = document.getElementById("dimensionNextBtn");
const datapackUI = document.getElementById("datapackUI");
const datapackList = document.getElementById("datapackList");
const datapackNextBtn = document.getElementById("datapackNextBtn");
const resourceUI = document.getElementById("resourceUI");
const resourceFileButton = document.getElementById("resourceFileButton");
const resourceFileInput = document.getElementById("resourceFileInput");

const removableMetadataPatterns = [
    /(?:^|\/)\.[^/]+(?:\/|$)/,
    /\.(?:md|py)$/i,
    /(?:^|\/)(?!license\.txt$)[^/]+\.txt$/i
];

const foldersToDelete = [
    "advancements/",
    "playerdata/",
    "players/",
    "stats/",
    "generated/",
    /^data\/minecraft\/scoreboard\.dat$/,
    /^(?:level\.dat_old|session\.lock)$/,
    /^(?:poi|dimensions\/(?:[^/]+\/)+poi)\//,
    ...removableMetadataPatterns
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

function matchesDeleteRule(filePath, rules = foldersToDelete) {
    return rules.some(rule => {
        if (typeof rule === "string") {
            return filePath.startsWith(rule);
        }
        return rule.test(filePath);
    });
}

function showLoading(message) {
    uploadUI.classList.add("hidden");
    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    resourceUI.classList.add("hidden");
    downloadBtn.classList.add("hidden");
    loadingText.textContent = message;
    loadingUI.classList.remove("hidden");
    dropZone.classList.remove("dimension-mode");
}

function hideLoading() {
    loadingUI.classList.add("hidden");
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
    hideLoading();
    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    resourceUI.classList.add("hidden");
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

resourceFileButton.addEventListener("click", (event) => {
    event.stopPropagation();
    resourceFileInput.click();
});

resourceFileInput.addEventListener("change", () => {
    processResourcePack(resourceFileInput.files[0]);
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
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (!resourceUI.classList.contains("hidden")) {
        processResourcePack(file);
        return;
    }

    handleFile(file);
});

// ---------------- CORE PIPELINE ----------------

async function handleFile(file) {
    if (!file) return;

    selectedFile = file;
    downloadFileName = defaultDownloadName(file.name);
    downloadFilename.textContent = downloadFileName;
    showLoading("Loading...");
    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    resourceUI.classList.add("hidden");
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

    showLoading("Analyzing...");

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

        if (matchesDeleteRule(worldPath)) {
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

    pendingCleanWorldZip = newZip;
    showResourceUpload();
}

function showResourceUpload() {
    hideLoading();
    dimensionUI.classList.add("hidden");
    datapackUI.classList.add("hidden");
    resourceUI.classList.remove("hidden");
    dropZone.classList.remove("dimension-mode");
}

async function processResourcePack(file) {
    if (!file || !pendingCleanWorldZip) return;

    showLoading("Cleaning...");

    try {
        const resourceZip = await JSZip.loadAsync(file);
        const resourceEntries = Object.entries(resourceZip.files);
        const packMetaPaths = resourceEntries
            .filter(([, entry]) => !entry.dir)
            .map(([path]) => normalizePath(path))
            .filter(path => path === "pack.mcmeta" || path.endsWith("/pack.mcmeta"));

        if (packMetaPaths.length !== 1) {
            throw new Error("The resource pack must contain exactly one pack.mcmeta file.");
        }

        const resourceRoot = findResourceRoot(resourceEntries);
        const cleanedResourceZip = new JSZip();

        for (const [path, entry] of resourceEntries) {
            const normalizedPath = normalizePath(path);
            if (resourceRoot && !normalizedPath.startsWith(resourceRoot)) continue;

            const resourcePath = normalizedPath.slice(resourceRoot.length);
            if (removableMetadataPatterns.some(pattern => pattern.test(resourcePath))) continue;
            if (entry.dir) continue;

            const content = await entry.async("uint8array");
            cleanedResourceZip.file(resourcePath, content);
        }

        const cleanedResourceBytes = await cleanedResourceZip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE"
        });
        pendingCleanWorldZip.file("resourcepacks/resources.zip", cleanedResourceBytes);
        cleanedBlob = await pendingCleanWorldZip.generateAsync({
            type: "blob",
            compression: "DEFLATE"
        });

        hideLoading();
        resourceFileInput.value = "";
        dropZone.classList.remove("dimension-mode");
        downloadBtn.classList.remove("hidden");
        downloadFilename.textContent = downloadFileName;
        convertAgainBtn.classList.remove("hidden");
    } catch (error) {
        resourceFileInput.value = "";
        alert(error.message || "The resource pack could not be processed.");
        showResourceUpload();
    }
}

// ---------------- DOWNLOAD ----------------

downloadFilename.addEventListener("click", event => {
    event.stopPropagation();
    beginDownloadNameEdit();
});

downloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    if (!cleanedBlob) {
        alert("The file isn't ready yet!");
        return;
    }

    const url = URL.createObjectURL(cleanedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadFileName;
    a.click();
    URL.revokeObjectURL(url);
});

// ---------------- RESET ----------------

convertAgainBtn.addEventListener("click", () => {
    selectedFile = null;
    cleanedBlob = null;
    downloadFileName = "Filename.zip";
    downloadFilename.textContent = downloadFileName;
    pendingZip = null;
    pendingEntries = null;
    pendingWorldRoot = null;
    pendingDimensions = null;
    pendingDatapacks = null;
    pendingSelectedDimensions = new Set();
    pendingCleanWorldZip = null;
    downloadBtn.style.minWidth = "";
    fileInput.value = "";
    resourceFileInput.value = "";
    hideLoading();

    uploadUI.classList.remove("hidden");
    dimensionUI.classList.add("hidden");
    dimensionList.innerHTML = "";
    datapackUI.classList.add("hidden");
    datapackList.innerHTML = "";
    resourceUI.classList.add("hidden");
    dropZone.classList.remove("dimension-mode");

    downloadBtn.classList.add("hidden");
    convertAgainBtn.classList.add("hidden");
});
