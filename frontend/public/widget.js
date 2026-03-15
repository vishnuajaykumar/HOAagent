(function() {
    // 1. Find the script tag and get the API key
    const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
    const apiKey = script ? script.getAttribute('data-key') : 'demo';
    
    // Use the origin of the script as the base URL for the widget
    const baseUrl = script ? new URL(script.src).origin : window.location.origin;

    // 2. Create the floating button
    const button = document.createElement('div');
    button.id = 'hoa-chat-widget-button';
    button.style.cssText = "position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; background: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 999999; transition: transform 0.3s; pointer-events: auto;";
    button.innerHTML = `
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
    `;
    document.body.appendChild(button);

    // 3. Create the Iframe Container
    const container = document.createElement('div');
    container.id = 'hoa-chat-widget-container';
    container.style.cssText = "position: fixed; bottom: 90px; right: 20px; width: 400px; height: 620px; max-height: 80vh; background: white; border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,0.2); z-index: 999999; overflow: hidden; display: none; border: 1px solid #e2e8f0; transition: opacity 0.3s, transform 0.3s; pointer-events: auto;";
    
    const iframe = document.createElement('iframe');
    iframe.src = `${baseUrl}/?key=${apiKey}&embed=true`;
    iframe.style.cssText = "width: 100%; height: 100%; border: none;";
    
    container.appendChild(iframe);
    document.body.appendChild(container);

    // 4. Toggle Logic
    let isOpen = false;
    button.addEventListener('click', () => {
        isOpen = !isOpen;
        container.style.display = isOpen ? 'block' : 'none';
        button.style.transform = isOpen ? 'scale(0.9) rotate(90deg)' : 'scale(1) rotate(0deg)';
        
        if (isOpen) {
            button.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        } else {
            button.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
        }
    });

    // Handle mobile responsiveness
    if (window.innerWidth < 480) {
        container.style.width = 'calc(100% - 40px)';
        container.style.right = '20px';
    }
})();
