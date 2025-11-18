(function () {
    document.getElementById('websiteForm').addEventListener('submit', async function(e) {
        e.preventDefault(); // stop normal submit for now

        const form = this;
        const formData = new FormData(form);

        // Convert FormData into a plain object
        const pages = {};
        for (let [key, value] of formData.entries()) {
            if (key.startsWith("pages[")) {
                // Example: pages[0][title] → extract properly
                pages[key] = value;
            }
        }

        // 1. Check credits BEFORE submitting for real
        const res = await fetch('/api/check-credits', {
            method: 'POST',
            body: JSON.stringify({ pages }),
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (!data.ok) {
            // 2. Show modal
            const msg = document.getElementById('creditsModalMessage');
            msg.innerHTML = `
            You tried to generate <strong>${data.pagesCount}</strong> page(s), 
            which costs <strong>${data.totalCost}</strong> credits,
            but you only have <strong>${data.available}</strong> credits.
            `;
            const modal = new bootstrap.Modal(document.getElementById('creditsModal'));
            modal.show();

            return; // don't submit the form
        }

        // 3. If enough credits → submit the form normally
        form.submit();
    })
})();
