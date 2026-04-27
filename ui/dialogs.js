/**
 * UI Dialogs - Modal Management
 */

const Dialogs = {
    open: (dialogId) => {
        const dialog = document.getElementById(dialogId);
        if (dialog) {
            dialog.style.display = 'block';
        }
    },

    close: (dialogId) => {
        const dialog = document.getElementById(dialogId);
        if (dialog) {
            dialog.style.display = 'none';
        }
    },

    setupCloseHandlers: () => {
        const closeButtons = document.querySelectorAll('.close-modal');
        closeButtons.forEach(btn => {
            btn.onclick = (e) => {
                const modal = e.target.closest('.modal');
                modal.style.display = 'none';
            };
        });

        window.onclick = (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        };
    }
};
