/* Wujinzang: progressive enhancement for ordinary Hugo pages. */
(() => {
  'use strict';

  function init() {
    const byId = (id) => document.getElementById(id);
    const toast = byId('toast');
    let toastTimer;

    function notify(message) {
      if (!toast) return;
      clearTimeout(toastTimer);
      toast.hidden = false;
      toast.textContent = message;
      toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 5000);
    }

    // Resolve against the actual page, never a potentially different <base>.
    function siteURL(value) {
      if (typeof value !== 'string') return null;
      const raw = value.trim();
      if (!raw || /^[?#]/.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
      try {
        const url = new URL(raw, window.location.href);
        if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin ||
            url.username || url.password) return null;
        return url;
      } catch {
        return null;
      }
    }

    const normalize = (value) => value.normalize('NFC').toLowerCase();
    const site = byId('site');
    const openButton = byId('open-search');
    const modal = byId('search-modal');
    const dialog = modal && modal.querySelector('.search-dialog');
    const closeButton = byId('close-search');
    const input = byId('search-input');
    const status = byId('search-status');
    const results = byId('search-results');

    if (site && openButton && modal && dialog && closeButton && input && status && results) {
      let isOpen = false;
      let revision = 0;
      let previousFocus = null;
      let previousInert = false;
      let previousOverflow = '';
      let previousOverflowPriority = '';
      let cachedIndex = null;
      let pendingIndex = null;

      dialog.setAttribute('tabindex', '-1');
      results.classList.add('search-results');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      openButton.setAttribute('aria-controls', 'search-modal');
      openButton.setAttribute('aria-haspopup', 'dialog');
      openButton.setAttribute('aria-expanded', 'false');
      openButton.hidden = false;

      function readIndex() {
        if (cachedIndex !== null) return Promise.resolve(cachedIndex);
        if (pendingIndex) return pendingIndex;

        pendingIndex = (async () => {
          const url = siteURL(document.body.dataset.searchIndex);
          if (!url) throw new Error('搜索索引地址无效，请稍后重新打开搜索重试。');
          if (typeof window.fetch !== 'function') {
            throw new Error('当前浏览器不支持加载搜索索引，请使用文章归档浏览。');
          }

          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
          let data;
          try {
            const response = await window.fetch(url.href, {
              mode: 'same-origin',
              credentials: 'omit',
              redirect: 'error',
              ...(controller ? { signal: controller.signal } : {})
            });
            if (!response.ok) throw new Error('HTTP failure');
            data = await response.json();
          } catch {
            throw new Error('暂时无法加载搜索索引，请检查网络后重新打开搜索重试。');
          } finally {
            if (timeout !== null) clearTimeout(timeout);
          }

          if (!Array.isArray(data)) {
            throw new Error('搜索索引格式无效，请稍后重新打开搜索重试。');
          }
          const posts = data.map((post) => {
            if (!post || typeof post !== 'object' ||
                !['title', 'date', 'summary', 'content'].every((key) => typeof post[key] === 'string') ||
                !Array.isArray(post.tags) || !post.tags.every((tag) => typeof tag === 'string')) {
              throw new Error('搜索索引格式无效，请稍后重新打开搜索重试。');
            }
            const link = siteURL(post.url);
            if (!link) {
              throw new Error('搜索索引包含无效文章链接，请稍后重新打开搜索重试。');
            }
            const parsedDate = Date.parse(post.date);
            return {
              title: post.title,
              date: post.date,
              summary: post.summary,
              tags: post.tags,
              url: link.href,
              timestamp: Number.isNaN(parsedDate) ? 0 : parsedDate,
              searchable: normalize([post.title, post.summary, post.content, ...post.tags].join('\n'))
            };
          });
          posts.sort((a, b) => b.timestamp - a.timestamp);
          cachedIndex = posts;
          return posts;
        })().finally(() => {
          // A rejected request is never cached; the next open can try again.
          pendingIndex = null;
        });
        return pendingIndex;
      }

      function renderResults(posts, query) {
        const found = query ? posts.filter((post) => post.searchable.includes(query)) : posts;
        const fragment = document.createDocumentFragment();
        found.forEach((post) => {
          const link = document.createElement('a');
          link.className = 'search-result';
          link.href = post.url;
          const title = document.createElement('strong');
          title.textContent = post.title;
          const detail = document.createElement('span');
          detail.textContent = [post.date, post.summary.slice(0, 160), post.tags.join(' · ')]
            .filter(Boolean).join(' · ');
          link.append(title, detail);
          fragment.append(link);
        });
        results.replaceChildren(fragment);
        status.textContent = found.length
          ? (query ? `找到 ${found.length} 篇文章。` : `最新文章，共 ${found.length} 篇。`)
          : (query ? '没有找到匹配的文字，换个关键词试试。' : '暂时没有可搜索的文章。');
      }

      async function refreshSearch() {
        const ticket = ++revision;
        const query = normalize(input.value.trim());
        if (!isOpen) return;
        results.replaceChildren();
        results.setAttribute('aria-busy', 'true');
        status.textContent = '正在加载文章…';
        try {
          const posts = await readIndex();
          if (!isOpen || ticket !== revision) return;
          renderResults(posts, query);
        } catch (error) {
          if (!isOpen || ticket !== revision) return;
          status.textContent = error.message;
        } finally {
          if (isOpen && ticket === revision) results.removeAttribute('aria-busy');
        }
      }

      function focusInput() {
        input.focus({ preventScroll: true });
        if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
      }

      function openSearch() {
        if (isOpen) {
          focusInput();
          return;
        }
        previousFocus = document.activeElement;
        previousInert = site.inert;
        previousOverflow = document.body.style.getPropertyValue('overflow');
        previousOverflowPriority = document.body.style.getPropertyPriority('overflow');
        isOpen = true;
        site.inert = true;
        document.body.style.setProperty('overflow', 'hidden', 'important');
        modal.hidden = false;
        openButton.setAttribute('aria-expanded', 'true');
        focusInput();
        void refreshSearch();
      }

      function closeSearch() {
        if (!isOpen) return;
        isOpen = false;
        ++revision;
        modal.hidden = true;
        site.inert = previousInert;
        if (previousOverflow) {
          document.body.style.setProperty('overflow', previousOverflow, previousOverflowPriority);
        } else {
          document.body.style.removeProperty('overflow');
        }
        openButton.setAttribute('aria-expanded', 'false');
        results.removeAttribute('aria-busy');
        const target = previousFocus && previousFocus.isConnected ? previousFocus : openButton;
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
        previousFocus = null;
      }

      function focusableElements() {
        return Array.from(dialog.querySelectorAll(
          'a[href], button, input, textarea, select, [tabindex], [contenteditable="true"]'
        )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') &&
          !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 &&
          !['hidden', 'collapse'].includes(window.getComputedStyle(element).visibility))
          .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
      }

      openButton.addEventListener('click', openSearch);
      closeButton.addEventListener('click', closeSearch);
      input.addEventListener('input', () => { void refreshSearch(); });
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closeSearch();
      });
      function followResult(event) {
        const link = event.target instanceof Element ? event.target.closest('a.search-result') : null;
        if (link && results.contains(link) && event.button <= 1) closeSearch();
        // Keep the anchor's native navigation, including modified/middle clicks.
      }
      results.addEventListener('click', followResult);
      results.addEventListener('auxclick', followResult);
      document.addEventListener('focusin', (event) => {
        if (isOpen && !dialog.contains(event.target)) focusInput();
      });
      document.addEventListener('keydown', (event) => {
        if (event.isComposing || event.defaultPrevented) return;
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          openSearch();
          return;
        }
        if (isOpen) {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeSearch();
          } else if (event.key === 'Tab') {
            const elements = focusableElements();
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (!first) {
              event.preventDefault();
              dialog.focus({ preventScroll: true });
            } else if (!elements.includes(document.activeElement) ||
                       (event.shiftKey && document.activeElement === first) ||
                       (!event.shiftKey && document.activeElement === last)) {
              event.preventDefault();
              (event.shiftKey ? last : first).focus();
            }
          }
          return;
        }
        if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        const editing = path.some((element) => element instanceof Element &&
          (element.isContentEditable || element.matches('input, textarea, select, [role="textbox"]')));
        if (!editing) {
          event.preventDefault();
          openSearch();
        }
      });
      window.addEventListener('pagehide', closeSearch);
    }

    const backTop = byId('back-top');
    if (backTop) {
      function updateBackTop() {
        backTop.hidden = window.scrollY < 500;
      }
      updateBackTop();
      window.addEventListener('scroll', updateBackTop, { passive: true });
      backTop.addEventListener('click', () => {
        const reduceMotion = typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' });
      });
    }

    document.querySelectorAll('.prose table').forEach((table) => {
      let wrapper = table.parentElement.closest('.table-scroll');
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'table-scroll';
        table.before(wrapper);
        wrapper.append(table);
      }
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', '表格');
      wrapper.setAttribute('tabindex', '0');
      // Keep overflow contained even when the theme stylesheet is unavailable.
      wrapper.style.maxWidth = '100%';
      wrapper.style.minWidth = '0';
      wrapper.style.overflowX = 'auto';
    });

    function selectCode(code) {
      try {
        const selection = window.getSelection();
        if (!selection) throw new Error('No selection');
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        notify('代码已选中，可按 ⌘C 或 Ctrl+C 复制。');
      } catch {
        notify('无法自动复制，请手动选中代码后按 ⌘C 或 Ctrl+C。');
      }
    }

    document.querySelectorAll('.prose pre').forEach((pre) => {
      if (pre.dataset.pineCopyReady === 'true') return;
      pre.dataset.pineCopyReady = 'true';
      let block = pre.parentElement;
      if (!(block.classList.contains('code-block') || block.classList.contains('highlight')) ||
          block.querySelectorAll('pre').length !== 1) {
        block = document.createElement('div');
        block.className = 'code-block';
        pre.before(block);
        block.append(pre);
      }
      let label = Array.from(block.children).find((child) => child.classList.contains('code-label'));
      if (!label) {
        label = document.createElement('div');
        label.className = 'code-label';
        const caption = document.createElement('span');
        caption.textContent = '代码';
        label.append(caption);
        block.insertBefore(label, pre);
      }
      let button = label.querySelector('button.copy-btn');
      if (!button) {
        button = document.createElement('button');
        button.className = 'copy-btn';
        label.append(button);
      }
      button.type = 'button';
      button.textContent = '复制';
      button.setAttribute('aria-label', '复制代码');
      button.addEventListener('click', async () => {
        const code = pre.querySelector('code') || pre;
        const text = code.textContent;
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('Clipboard unavailable');
          }
          // Invoked only by this user click; the button is outside the pre.
          await navigator.clipboard.writeText(text);
          notify('代码已复制。');
        } catch {
          selectCode(code);
        }
      });
    });

    function enhanceTOC() {
      const linksByHeading = new Map();
      document.querySelectorAll('.toc a[href], #TableOfContents a[href]').forEach((link) => {
        let url;
        try {
          url = new URL(link.getAttribute('href'), window.location.href);
        } catch {
          return;
        }
        if (url.origin !== window.location.origin || url.pathname !== window.location.pathname ||
            url.search !== window.location.search || !url.hash) return;
        let heading;
        try {
          heading = byId(decodeURIComponent(url.hash.slice(1)));
        } catch {
          return;
        }
        if (!heading || !/^H[1-6]$/.test(heading.tagName) || !heading.closest('.prose')) return;
        if (!linksByHeading.has(heading)) linksByHeading.set(heading, []);
        linksByHeading.get(heading).push(link);
      });
      if (!linksByHeading.size) return;
      const headings = Array.from(document.querySelectorAll(
        '.prose h1[id], .prose h2[id], .prose h3[id], .prose h4[id], .prose h5[id], .prose h6[id]'
      )).filter((heading) => linksByHeading.has(heading));

      function markCurrent(current) {
        linksByHeading.forEach((links, heading) => {
          links.forEach((link) => {
            if (heading === current) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
          });
        });
      }
      function updateCurrent() {
        const pagePadding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        let current = headings[0];
        headings.forEach((heading) => {
          const margin = parseFloat(getComputedStyle(heading).scrollMarginTop) || 0;
          if (heading.getBoundingClientRect().top <= pagePadding + margin + 2) current = heading;
        });
        if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
          current = headings[headings.length - 1];
        }
        markCurrent(current);
      }
      let frame = 0;
      function scheduleCurrent() {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          updateCurrent();
        });
      }
      linksByHeading.forEach((links, heading) => {
        links.forEach((link) => link.addEventListener('click', (event) => {
          if (!event.defaultPrevented && event.button === 0 &&
              !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
              new URL(link.href, window.location.href).hash === window.location.hash) {
            event.preventDefault();
            const reduceMotion = typeof window.matchMedia === 'function' &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            heading.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth' });
          }
          markCurrent(heading);
          scheduleCurrent();
        }));
      });
      updateCurrent();
      // Scroll events also cover jumps across paragraphs with no visible heading.
      window.addEventListener('scroll', scheduleCurrent, { passive: true });
      window.addEventListener('resize', scheduleCurrent, { passive: true });
      window.addEventListener('hashchange', scheduleCurrent);
      window.addEventListener('load', scheduleCurrent);
      if (typeof ResizeObserver === 'function') {
        const prose = document.querySelector('.prose');
        if (prose) new ResizeObserver(scheduleCurrent).observe(prose);
      }
    }
    enhanceTOC();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
