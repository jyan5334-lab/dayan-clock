lucide.createIcons();
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => window.wallpaper.action(button.dataset.action)));
