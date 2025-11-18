
// Show "Not enough credits" modal when redirected with ?creditsError=1
(function () {
    const params = new URLSearchParams(window.location.search);
    const hasError = params.get('creditsError');
    if (!hasError) return;

    const needed = params.get('needed') || '?';
    const has = params.get('has') || '?';
    const pages = params.get('pages') || '?';

    const messageEl = document.getElementById('creditsModalMessage');
    if (messageEl) {
        messageEl.innerHTML = `
        You tried to generate <strong>${pages}</strong> page(s), which costs <strong>${needed}</strong> credits,
        but you only have <strong>${has}</strong> credits.<br><br>
        Please buy more credits to continue.
        `;
    }

    const modalEl = document.getElementById('creditsModal');
    if (!modalEl) return;

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
})();

