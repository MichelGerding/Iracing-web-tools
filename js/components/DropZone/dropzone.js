class DropZone extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="../../js/components/DropZone/dropzone.css">
      <div class="drop-zone" id="zone">
        <input type="file" id="input" multiple="multiple"/>
        <div class="dz-icon" id="icon">⬡</div>
        <div class="dz-label">
          <strong id="title">Drop file here</strong><br>
          <span id="subtitle">or click to browse</span>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.zone = this.shadowRoot.querySelector("#zone");
    this.input = this.shadowRoot.querySelector("#input");

    // Attributes
    this.input.accept = this.getAttribute("accept") || "";
    this.setTextFromAttributes();

    // Click handled automatically by input overlay

    // Drag events
    ["dragenter", "dragover"].forEach(evt =>
      this.zone.addEventListener(evt, e => {
        e.preventDefault();
        this.zone.classList.add("drag-over");
      })
    );

    ["dragleave", "drop"].forEach(evt =>
      this.zone.addEventListener(evt, e => {
        e.preventDefault();
        this.zone.classList.remove("drag-over");
      })
    );

    this.zone.addEventListener("drop", (e) => {
      const files = e.dataTransfer.files;
      this.handleFiles(files);
    });

    this.input.addEventListener("change", (e) => {
      this.handleFiles(e.target.files);
    });
  }

  setTextFromAttributes() {
    const icon = this.getAttribute("icon");
    const title = this.getAttribute("title");
    const subtitle = this.getAttribute("subtitle");

    if (icon) this.shadowRoot.querySelector("#icon").textContent = icon;
    if (title) this.shadowRoot.querySelector("#title").textContent = title;
    if (subtitle) this.shadowRoot.querySelector("#subtitle").textContent = subtitle;
  }

  handleFiles(files) {
    if (!files || !files.length) return;

    this.dispatchEvent(new CustomEvent("file-selected", {
      detail: { files },
      bubbles: true,
      composed: true
    }));
  }
}

customElements.define("drop-zone", DropZone);
