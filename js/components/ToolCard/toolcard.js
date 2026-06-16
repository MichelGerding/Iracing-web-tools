class ToolCard extends HTMLElement {
    connectedCallback() {
        const name  = this.getAttribute('name');
        const desc  = this.getAttribute('description');
        const href  = this.getAttribute('href') || '#';
        const badge = this.getAttribute('badge') || '';

        const badgeMap = {
            ready: { label: 'Ready',       cls: 'badge-accent'  },
            soon:  { label: 'Coming soon', cls: 'badge-default' },
        };
        const b = badgeMap[badge] || {};

        this.innerHTML = `
            <div class="tool-card">
                <a href="${href}">
                    <div class="flex items-center justify-between">
                        <span class="tool-name">${name}</span>
                    </div>
                    <p class="tool-desc">${desc}</p>
                </a>
            </div>
        `;
    }
}

// load the css stylesheet in the heaeder
const link = document.createElement("link")
link.type = "text/css";
link.rel = "stylesheet";
link.href = "js/components/ToolCard/toolcard.css";

document.head.appendChild(link)
customElements.define('tool-card', ToolCard);


