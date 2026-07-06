/**
 * NoDistract - Reader Mode for Any Webpage
 * Extracts main content, images and video players, removing clutter for easy reading
 * @version 2.1.0
 * @license MIT
 */

class NoDistract {
	constructor() {
		this.readabilityLoaded = false;
		this.prefs = this.loadPrefs();
		this.init();
	}

	/**
	 * Loads reading preferences (theme, font size) from localStorage,
	 * defaulting the theme to the system preference
	 */
	loadPrefs() {
		const prefs = {
			fontScale: 1,
			dark: window.matchMedia?.("(prefers-color-scheme: dark)").matches || false
		};
		try {
			const saved = JSON.parse(localStorage.getItem("nodistract-prefs"));
			if (saved) Object.assign(prefs, saved);
		} catch (e) { /* localStorage may be blocked; use defaults */ }
		return prefs;
	}

	savePrefs() {
		try {
			localStorage.setItem("nodistract-prefs", JSON.stringify(this.prefs));
		} catch (e) { /* localStorage may be blocked; preferences won't persist */ }
	}

	/**
	 * Applies current preferences to the reader page
	 */
	applyPrefs() {
		document.body.style.setProperty("--nd-font-scale", this.prefs.fontScale);
		document.body.classList.toggle("readable-dark", this.prefs.dark);
		const themeButton = document.querySelector(".readable-theme");
		if (themeButton) themeButton.textContent = this.prefs.dark ? "☀️" : "🌙";
	}

	/**
	 * Creates a clean, readable article page
	 */
	createArticlePage(title, author, content, image) {
		// Capture video players BEFORE wiping the page (Readability drops them)
		const videos = this.detectVideos();

		// Disable all scripts on the page before switching to reader mode
		this.disablePageScripts();
		
		// Reset page
		document.body.innerHTML = "";
		document.body.className = "";
		document.documentElement.style.overflow = "auto";

		// Create main container
		const page = document.createElement("article");
		page.className = "readable-page";

		// Add title
		if (title) {
			const pageTitle = document.createElement("h1");
			pageTitle.className = "readable-title";
			pageTitle.textContent = title;
			page.appendChild(pageTitle);
		}

		// Add author/byline
		if (author) {
			const pageAuthor = document.createElement("p");
			pageAuthor.className = "readable-author";
			pageAuthor.textContent = author;
			page.appendChild(pageAuthor);
		}

		// Add video players (streams, embeds) detected on the original page
		if (videos.length) {
			const videoSection = document.createElement("div");
			videoSection.className = "readable-videos";

			videos.forEach(item => {
				const wrapper = document.createElement("div");
				wrapper.className = "readable-video-wrapper";

				if (item.type === "video") {
					// Reuse the original <video> node to keep its sources/state
					item.element.controls = true;
					item.element.removeAttribute("width");
					item.element.removeAttribute("height");
					wrapper.appendChild(item.element);
				} else {
					const frame = document.createElement("iframe");
					frame.src = item.src;
					frame.allowFullscreen = true;
					frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
					// Sandbox without allow-popups: the player runs, but its pop-up ads don't
					frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
					wrapper.appendChild(frame);
				}

				videoSection.appendChild(wrapper);
			});

			page.appendChild(videoSection);
		}

		// Add featured image
		if (image) {
			const pageImage = document.createElement("img");
			pageImage.className = "readable-image";
			pageImage.src = image;
			pageImage.alt = title || "Article image";
			pageImage.onerror = () => pageImage.style.display = "none";
			page.appendChild(pageImage);
		}

		// Add main content
		const pageContent = document.createElement("div");
		pageContent.className = "readable-content";
		pageContent.innerHTML = content;

		// Readability keeps some known embeds (e.g. YouTube) in the content;
		// remove them there so they only appear once, in the video section
		if (videos.length) {
			const detectedSrcs = new Set(videos.map(v => v.src).filter(Boolean));
			pageContent.querySelectorAll("iframe, video").forEach(el => {
				if (detectedSrcs.has(el.src)) el.remove();
			});
		}

		page.appendChild(pageContent);

		// Add toolbar: font size, theme toggle and close
		const toolbar = document.createElement("div");
		toolbar.className = "readable-toolbar";

		const makeButton = (className, label, title, onClick) => {
			const button = document.createElement("button");
			button.className = "readable-button " + className;
			button.textContent = label;
			button.title = title;
			button.onclick = onClick;
			toolbar.appendChild(button);
			return button;
		};

		makeButton("readable-font-down", "A−", "Diminuir fonte", () => this.changeFontSize(-0.1));
		makeButton("readable-font-up", "A+", "Aumentar fonte", () => this.changeFontSize(0.1));
		makeButton("readable-theme", "🌙", "Alternar tema claro/escuro", () => {
			this.prefs.dark = !this.prefs.dark;
			this.savePrefs();
			this.applyPrefs();
		});
		makeButton("readable-close", "✕ Fechar", "Fechar modo leitura", () => location.reload());

		page.appendChild(toolbar);

		// Inject styles
		this.injectStyles();

		// Append to body
		document.body.appendChild(page);

		// Apply saved theme and font size
		this.applyPrefs();

		// Scroll to top
		window.scrollTo(0, 0);
	}

	/**
	 * Adjusts the reading font size within sane bounds
	 */
	changeFontSize(delta) {
		this.prefs.fontScale = Math.min(1.6, Math.max(0.8, Math.round((this.prefs.fontScale + delta) * 10) / 10));
		this.savePrefs();
		this.applyPrefs();
	}

	/**
	 * Finds video players on the original page (native <video> and embed iframes),
	 * filtering out ad/tracker iframes. Must run before the page is wiped.
	 */
	detectVideos() {
		const videos = [];
		const seen = new Set();

		const adPatterns = /doubleclick|googlesyndication|googleads|adservice|adsystem|amazon-adsystem|taboola|outbrain|criteo|popads|propeller|adsterra|recaptcha|disqus|facebook\.com\/plugins|platform\.twitter/i;
		const playerPatterns = /youtube|youtu\.be|vimeo|dailymotion|ok\.ru|blogger\.com\/video|streamtape|filemoon|mixdrop|dood|mp4upload|voe\.|vidhide|filelions|luluvdo|csst\.|warezcdn|embed|\/e\/|player|\.mp4|\.m3u8/i;

		// Native <video> elements — keep a reference to the original node
		document.querySelectorAll("video").forEach(video => {
			const src = video.currentSrc || video.src || video.querySelector("source")?.src || "";
			const key = src || "video-" + videos.length;
			if (seen.has(key)) return;
			seen.add(key);
			videos.push({ type: "video", element: video, src });
		});

		// Iframes that look like video players (by URL or by size)
		document.querySelectorAll("iframe").forEach(frame => {
			const src = frame.src || frame.dataset.src || frame.dataset.lazySrc || "";
			if (!src || src === "about:blank" || adPatterns.test(src)) return;

			const rect = frame.getBoundingClientRect();
			const looksLikePlayer = playerPatterns.test(src) || (rect.width >= 300 && rect.height >= 150);
			if (!looksLikePlayer || seen.has(src)) return;

			seen.add(src);
			videos.push({ type: "iframe", src });
		});

		return videos;
	}

	/**
	 * Disables all scripts on the page to prevent popups and interruptions
	 */
	disablePageScripts() {
		// Remove all script tags from the page
		const scripts = document.querySelectorAll('script');
		scripts.forEach(script => {
			// Don't remove the Readability library or this script itself
			if (!script.src.includes('readability') && !script.src.includes('nodistract')) {
				script.remove();
			}
		});

		// Stop all timers and intervals
		const highestTimeoutId = setTimeout(() => {}, 0);
		for (let i = 0; i < highestTimeoutId; i++) {
			clearTimeout(i);
		}

		const highestIntervalId = setInterval(() => {}, 0);
		for (let i = 0; i < highestIntervalId; i++) {
			clearInterval(i);
		}

		// Disable inline event handlers by cloning and replacing all elements
		// This prevents onclick, onload, etc. from firing
		const allElements = document.querySelectorAll('*');
		allElements.forEach(element => {
			// Remove all event listener attributes
			const attributes = Array.from(element.attributes);
			attributes.forEach(attr => {
				if (attr.name.startsWith('on')) {
					element.removeAttribute(attr.name);
				}
			});
		});

		// Override common methods that could trigger popups
		window.alert = () => {};
		window.confirm = () => false;
		window.prompt = () => null;
		
		// Prevent new scripts from being added
		const originalAppendChild = Element.prototype.appendChild;
		Element.prototype.appendChild = function(child) {
			if (child.tagName === 'SCRIPT') {
				// Only allow Readability and NoDistract scripts
				if (child.src && (child.src.includes('readability') || child.src.includes('nodistract'))) {
					return originalAppendChild.call(this, child);
				}
				return child;
			}
			return originalAppendChild.call(this, child);
		};
	}

	/**
	 * Injects CSS styles for the readable page
	 */
	injectStyles() {
		// Check if styles already exist
		if (document.querySelector('style[data-readable]')) return;

		const style = document.createElement("style");
		style.setAttribute('data-readable', 'true');
		style.textContent = `
			* {
				box-sizing: border-box;
			}
			
			body {
				margin: 0;
				padding: 20px;
				background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
				line-height: 1.6;
				color: #333;
			}

			.readable-page {
				max-width: 800px;
				margin: 0 auto;
				padding: 40px;
				background: #ffffff;
				box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
				border-radius: 8px;
				position: relative;
			}

			.readable-title {
				font-size: 2.5rem;
				font-weight: 700;
				margin: 0 0 20px 0;
				line-height: 1.2;
				color: #1a1a1a;
			}

			.readable-author {
				font-size: 1rem;
				color: #666;
				margin: 0 0 30px 0;
				font-style: italic;
			}

			.readable-image {
				width: 100%;
				height: auto;
				margin: 0 0 30px 0;
				border-radius: 4px;
				display: block;
			}

			.readable-videos {
				margin: 0 0 30px 0;
			}

			.readable-video-wrapper {
				position: relative;
				width: 100%;
				aspect-ratio: 16 / 9;
				margin: 0 0 20px 0;
				background: #000;
				border-radius: 8px;
				overflow: hidden;
			}

			.readable-video-wrapper iframe,
			.readable-video-wrapper video {
				position: absolute;
				inset: 0;
				width: 100%;
				height: 100%;
				border: 0;
			}

			.readable-content {
				font-size: calc(1.125rem * var(--nd-font-scale, 1));
				line-height: 1.8;
				color: #2c3e50;
			}

			.readable-content p {
				margin: 0 0 1.5em 0;
			}

			.readable-content h1,
			.readable-content h2,
			.readable-content h3,
			.readable-content h4 {
				margin: 1.5em 0 0.5em 0;
				font-weight: 600;
				line-height: 1.3;
			}

			.readable-content h2 {
				font-size: 1.75rem;
			}

			.readable-content h3 {
				font-size: 1.5rem;
			}

			.readable-content img {
				max-width: 100%;
				height: auto;
				display: block;
				margin: 2em auto;
				border-radius: 4px;
			}

			.readable-content figure {
				margin: 2em 0;
				text-align: center;
			}

			.readable-content figcaption {
				font-size: 0.9rem;
				color: #666;
				margin-top: 0.5em;
				font-style: italic;
			}

			.readable-content a {
				color: #3498db;
				text-decoration: none;
				border-bottom: 1px solid #3498db;
			}

			.readable-content a:hover {
				color: #2980b9;
				border-bottom-color: #2980b9;
			}

			.readable-content blockquote {
				margin: 1.5em 0;
				padding: 1em 1.5em;
				border-left: 4px solid #3498db;
				background: #f8f9fa;
				font-style: italic;
			}

			.readable-content code {
				background: #f4f4f4;
				padding: 2px 6px;
				border-radius: 3px;
				font-family: "Courier New", Courier, monospace;
				font-size: 0.9em;
			}

			.readable-content pre {
				background: #2c3e50;
				color: #ecf0f1;
				padding: 1em;
				border-radius: 4px;
				overflow-x: auto;
			}

			.readable-content pre code {
				background: transparent;
				color: inherit;
				padding: 0;
			}

			.readable-content ul,
			.readable-content ol {
				margin: 1em 0;
				padding-left: 2em;
			}

			.readable-content li {
				margin: 0.5em 0;
			}

			.readable-toolbar {
				position: fixed;
				top: 20px;
				right: 20px;
				display: flex;
				gap: 8px;
				z-index: 1000;
			}

			.readable-button {
				background: #ffffff;
				color: #2c3e50;
				border: none;
				padding: 12px 16px;
				border-radius: 50px;
				cursor: pointer;
				font-size: 0.9rem;
				font-weight: 600;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
				transition: all 0.3s ease;
			}

			.readable-button:hover {
				transform: translateY(-2px);
				box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
			}

			.readable-close {
				background: #e74c3c;
				color: white;
				padding: 12px 24px;
				box-shadow: 0 4px 12px rgba(231, 76, 60, 0.4);
			}

			.readable-close:hover {
				background: #c0392b;
				box-shadow: 0 6px 16px rgba(231, 76, 60, 0.5);
			}

			/* Dark theme */
			body.readable-dark {
				background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
				color: #d5d9e0;
			}

			body.readable-dark .readable-page {
				background: #1f2937;
				box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
			}

			body.readable-dark .readable-title {
				color: #f3f4f6;
			}

			body.readable-dark .readable-author {
				color: #9ca3af;
			}

			body.readable-dark .readable-content {
				color: #d5d9e0;
			}

			body.readable-dark .readable-content blockquote {
				background: #111827;
				border-left-color: #60a5fa;
			}

			body.readable-dark .readable-content code {
				background: #111827;
				color: #e5e7eb;
			}

			body.readable-dark .readable-content a {
				color: #60a5fa;
				border-bottom-color: #60a5fa;
			}

			body.readable-dark .readable-content a:hover {
				color: #93c5fd;
				border-bottom-color: #93c5fd;
			}

			body.readable-dark .readable-content figcaption {
				color: #9ca3af;
			}

			body.readable-dark .readable-button {
				background: #374151;
				color: #f3f4f6;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
			}

			body.readable-dark .readable-close {
				background: #e74c3c;
				color: white;
			}

			/* Responsive design */
			@media (max-width: 768px) {
				body {
					padding: 10px;
				}

				.readable-page {
					padding: 20px;
				}

				.readable-title {
					font-size: 1.75rem;
				}

				.readable-content {
					font-size: calc(1rem * var(--nd-font-scale, 1));
				}

				.readable-toolbar {
					top: 10px;
					right: 10px;
					gap: 6px;
				}

				.readable-button {
					padding: 10px 14px;
					font-size: 0.85rem;
				}

				.readable-close {
					padding: 10px 20px;
				}
			}

			/* Print styles */
			@media print {
				body {
					background: white;
					padding: 0;
				}

				.readable-page {
					box-shadow: none;
					padding: 0;
				}

				.readable-toolbar {
					display: none;
				}
			}
		`;
		document.head.appendChild(style);
	}

	/**
	 * Parses the current page using Readability
	 */
	parseArticle() {
		let article = null;

		try {
			if (typeof Readability === 'undefined') {
				throw new Error('Readability library not loaded');
			}

			const documentClone = document.cloneNode(true);
			// charThreshold lowered so pages with little text (e.g. video pages) still parse
			article = new Readability(documentClone, { charThreshold: 100 }).parse();
		} catch (error) {
			// Keep going: pages with video players often have no extractable text,
			// and the reader page is still useful to isolate the player
			console.warn('NoDistract: could not parse article text:', error);
		}

		this.createArticlePage(
			article?.title || document.title,
			article?.byline || '',
			article?.content || '<p>Não foi possível extrair o conteúdo de texto desta página.</p>',
			article?.image || ''
		);
	}

	/**
	 * Dynamically imports an external script
	 */
	async importScript(url) {
		return new Promise((resolve, reject) => {
			// Check if script already loaded
			if (document.querySelector(`script[src="${url}"]`)) {
				resolve();
				return;
			}

			const script = document.createElement("script");
			script.src = url;
			script.onload = resolve;
			script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
			document.head.appendChild(script);
		});
	}

	/**
	 * Initializes the reader mode
	 */
	async init() {
		try {
			// Show loading indicator
			const loader = document.createElement('div');
			loader.id = 'readable-loader';
			loader.innerHTML = '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:20px 40px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);z-index:9999;font-family:sans-serif;">Carregando modo leitura...</div>';
			document.body.appendChild(loader);

			// Load only Readability library (removed jQuery and Bootstrap)
			await this.importScript(
				"https://cdn.jsdelivr.net/npm/@mozilla/readability@0.4.4/Readability.min.js"
			);

			// Remove loader
			loader.remove();

			// Parse the article
			this.parseArticle();
		} catch (error) {
			console.error('Initialization error:', error);
			alert('Erro ao inicializar o modo leitura: ' + error.message);
			document.getElementById('readable-loader')?.remove();
		}
	}
}

// Initialize when script loads
new NoDistract();