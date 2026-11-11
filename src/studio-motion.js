/* Small presentation-only effects. No import, history or decision access. */
(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pending = new Set();
  let frame = 0;
  const scrollable = '.table-wrap, .meter-panel, .area-signal-list, .rail-more > .rail-lists';

  function edge(el) {
    const room = el.scrollHeight - el.clientHeight;
    const value = room < 2 ? 'none' : el.scrollTop < 2 ? 'start' : el.scrollTop >= room - 2 ? 'end' : 'middle';
    if (el.dataset.scrollEdge !== value) el.dataset.scrollEdge = value;
  }
  function flush() {
    frame = 0;
    pending.forEach(edge);
    pending.clear();
    document.querySelector('.topbar')?.classList.toggle('is-scrolled', window.scrollY > 12);
  }
  function queue(el) {
    if (el) pending.add(el);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  document.addEventListener('scroll', event => {
    if (event.target instanceof Element && event.target.matches(scrollable)) queue(event.target);
    else if (event.target === document) queue();
  }, { capture: true, passive: true });

  // A resize and a new page of meters can change which scroll edges exist.
  const table = document.querySelector('.table-wrap');
  const panel = document.querySelector('.meter-panel');
  if (typeof ResizeObserver === 'function') {
    const resize = new ResizeObserver(entries => entries.forEach(({ target }) => queue(target)));
    [table, panel].filter(Boolean).forEach(el => resize.observe(el));
  }
  const rows = document.getElementById('rows');
  if (rows) new MutationObserver(() => queue(table)).observe(rows, { childList: true });
  window.addEventListener('resize', () => document.querySelectorAll(scrollable).forEach(queue), { passive: true });

  function visibleRows() {
    if (!table) return [];
    const area = table.getBoundingClientRect();
    return [...table.querySelectorAll('tr.row')].map(el => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.bottom > Math.max(area.top, 0) && box.top < Math.min(area.bottom, innerHeight));
  }
  document.addEventListener('click', event => {
    if (reduced.matches || !(event.target instanceof Element)) return;
    const sort = event.target.closest('[data-sort], [data-sort-option], #sortDirection, [data-menu-sort]');
    if (sort) {
      const old = new Map(visibleRows().map(({ el, box }) => [el.dataset.id, box.top]));
      requestAnimationFrame(() => {
        visibleRows().slice(0, 24).forEach(({ el, box }, i) => {
          const from = old.get(el.dataset.id);
          if (from == null) {
            el.animate?.([{ opacity: .45 }, { opacity: 1 }], { duration: 220, delay: Math.min(i * 7, 63), easing: 'ease-out' });
          } else {
            const distance = from - box.top;
            if (Math.abs(distance) < 2 || Math.abs(distance) > innerHeight) return;
            el.animate?.([{ transform: `translateY(${distance}px)`, opacity: .6 }, { transform: 'translateY(0)', opacity: 1 }],
              { duration: 260, easing: 'cubic-bezier(.2,.75,.25,1)' });
          }
        });
        queue(table);
      });
    } else if (event.target.closest('.addr, .map-pin, [data-focus]')) {
      requestAnimationFrame(() => {
        if (document.getElementById('focus')?.hidden) return;
        document.querySelector('.focus-head')?.animate?.([{ opacity: .6, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 200, easing: 'ease-out' });
      });
    }
  }, true);
  reduced.addEventListener?.('change', () => {
    if (reduced.matches) document.querySelectorAll('#rows tr.row, .focus-head').forEach(el => el.getAnimations().forEach(a => a.cancel()));
  });
  document.querySelectorAll(scrollable).forEach(queue);
}());
