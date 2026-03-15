(function() {
    const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
    const apiKey = script ? script.getAttribute('data-key') : 'demo';
    const baseUrl = script ? new URL(script.src).origin : window.location.origin;

    const style = document.createElement('style');
    style.innerHTML = `
        #hoa-chat-widget-button {
            transition: transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
        }
        #hoa-chat-widget-button:hover {
            transform: scale(1.05);
        }
    `;
    document.head.appendChild(style);

    // 1. Create Button
    const button = document.createElement('div');
    button.id = 'hoa-chat-widget-button';
    button.style.cssText = "position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px; background: #000000; border-radius: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 999999; pointer-events: auto;";
    button.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
    `;
    document.body.appendChild(button);

    // 2. Create Container
    const container = document.createElement('div');
    container.id = 'hoa-chat-widget-container';
    // Native resize + overflow hidden allows resizing from bottom-right corner
    container.style.cssText = "position: fixed; bottom: 100px; right: 24px; width: 380px; height: 600px; min-width: 300px; min-height: 400px; max-height: 85vh; max-width: 90vw; background: transparent; border-radius: 16px; border: 1px solid #d2d2d7; box-shadow: 0 10px 40px rgba(0,0,0,0.1); z-index: 999999; overflow: hidden; display: none; transition: opacity 0.3s cubic-bezier(0.25, 0.1, 0.25, 1); pointer-events: auto; flex-direction: column;";
    
    // Drag Handle area (invisible, overlays the top part of the iframe)
    const dragHandle = document.createElement('div');
    dragHandle.style.cssText = "position: absolute; top: 0; left: 0; right: 40px; height: 50px; background: transparent; cursor: grab; z-index: 10;";
    container.appendChild(dragHandle);

    const iframe = document.createElement('iframe');
    iframe.src = `${baseUrl}/?key=${apiKey}&embed=true`;
    iframe.style.cssText = "width: 100%; height: 100%; border: none; border-radius: 16px; background: rgba(255,255,255,0.95);";
    container.appendChild(iframe);
    document.body.appendChild(container);

    // 3. Toggle Logic
    let isOpen = false;
    button.addEventListener('click', () => {
        isOpen = !isOpen;
        container.style.display = isOpen ? 'flex' : 'none';
        
        if (isOpen) {
            button.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        } else {
            button.innerHTML = `
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
            `;
            // Reset position/size when closed
            container.style.bottom = '100px';
            container.style.right = '24px';
            container.style.top = 'auto';
            container.style.left = 'auto';
            container.style.width = '380px';
            container.style.height = '600px';
        }
    });

    // 4. Drag Logic
    let isDragging = false;
    let startX, startY, initialX, initialY;

    dragHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        dragHandle.style.cursor = 'grabbing';
        iframe.style.pointerEvents = 'none'; // Prevent iframe from swallowing mousemove
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        container.style.left = `${initialX + dx}px`;
        container.style.top = `${initialY + dy}px`;
        container.style.bottom = 'auto';
        container.style.right = 'auto';
    }

    function onMouseUp() {
        isDragging = false;
        dragHandle.style.cursor = 'grab';
        iframe.style.pointerEvents = 'auto';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // 5. Top-Left Resize Logic
    const resizeHandleTL = document.createElement('div');
    resizeHandleTL.style.cssText = "position: absolute; top: 0; left: 0; width: 24px; height: 24px; cursor: nwse-resize; z-index: 100; display: flex; align-items: center; justify-content: center;";
    resizeHandleTL.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" style="opacity:0.4; transform:rotate(90deg);">
      <line x1="0" y1="12" x2="12" y2="0" stroke="#888" stroke-width="1.5"/>
      <line x1="0" y1="8" x2="8" y2="0" stroke="#888" stroke-width="1.5"/>
      <line x1="0" y1="4" x2="4" y2="0" stroke="#888" stroke-width="1.5"/>
    </svg>`;
    container.appendChild(resizeHandleTL);

    let isResizingTL = false;
    let startResizeX, startResizeY, initialWidth, initialHeight, initialTop, initialLeft;

    resizeHandleTL.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isResizingTL = true;
        startResizeX = e.clientX;
        startResizeY = e.clientY;
        const rect = container.getBoundingClientRect();
        initialWidth = rect.width;
        initialHeight = rect.height;
        initialTop = rect.top;
        initialLeft = rect.left;
        iframe.style.pointerEvents = 'none';
        document.addEventListener('mousemove', onResizeMouseMove);
        document.addEventListener('mouseup', onResizeMouseUp);
    });

    function onResizeMouseMove(e) {
        if (!isResizingTL) return;
        let dx = e.clientX - startResizeX;
        let dy = e.clientY - startResizeY;
        
        let newWidth = initialWidth - dx;
        let newHeight = initialHeight - dy;
        
        if (newWidth < 300) { newWidth = 300; dx = initialWidth - 300; }
        if (newHeight < 400) { newHeight = 400; dy = initialHeight - 400; }

        container.style.left = `${initialLeft + dx}px`;
        container.style.top = `${initialTop + dy}px`;
        container.style.width = `${newWidth}px`;
        container.style.height = `${newHeight}px`;
        container.style.bottom = 'auto';
        container.style.right = 'auto';
    }

    function onResizeMouseUp() {
        isResizingTL = false;
        iframe.style.pointerEvents = 'auto';
        document.removeEventListener('mousemove', onResizeMouseMove);
        document.removeEventListener('mouseup', onResizeMouseUp);
    }

    // Handle mobile responsiveness
    if (window.innerWidth < 480) {
        container.style.width = 'calc(100% - 40px)';
        container.style.right = '20px';
        container.style.minWidth = '200px';
    }
})();
