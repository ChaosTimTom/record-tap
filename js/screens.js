/**
 * Screen management - handles transitions and UI state for all screens.
 */
class ScreenManager {
    constructor() {
        this.screens = {};
        this.currentScreen = null;

        // Cache all screen elements
        document.querySelectorAll('.screen, .overlay').forEach(el => {
            this.screens[el.id] = el;
        });
    }

    show(screenId) {
        // Hide all screens (not overlays)
        Object.values(this.screens).forEach(el => {
            if (el.classList.contains('screen')) {
                el.classList.remove('active');
            }
        });
        // Show target
        const screen = this.screens[screenId];
        if (screen) {
            screen.classList.add('active');
            this.currentScreen = screenId;
        }
    }

    showOverlay(overlayId) {
        const overlay = this.screens[overlayId];
        if (overlay) overlay.classList.add('active');
    }

    hideOverlay(overlayId) {
        const overlay = this.screens[overlayId];
        if (overlay) overlay.classList.remove('active');
    }

    hideAllOverlays() {
        Object.values(this.screens).forEach(el => {
            if (el.classList.contains('overlay')) {
                el.classList.remove('active');
            }
        });
    }
}

window.ScreenManager = ScreenManager;
