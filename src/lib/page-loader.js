/**
 * Page loader
 * ===========
 * Works out what pressing a pagination control would do, and for controls
 * that would load a whole new web page, loads that page in the background
 * instead. The user's page stays where it is, and our script keeps running
 * (a full page load would stop it).
 *
 * The kinds of controls:
 *   click     - updates the table in place with JavaScript. We press it.
 *   link      - a normal link to another address, like ?page=2. We fetch it.
 *   postback  - ASP.NET WebForms __doPostBack(...). We send the page's form
 *               exactly like the browser would.
 *   submit    - a submit button inside a form. We send the form.
 *   unsupported - goes to another website; we can't load that.
 */
(function () {
  'use strict';

  const POSTBACK_PATTERN = /__doPostBack\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/;

  // ---------------------------------------------------------------------------
  // What does this control do?
  // ---------------------------------------------------------------------------

  /**
   * @param {Element} control  the button or link that changes the page
   * @param {string} pageUrl   address of the page the control is on
   */
  function describeControl(control, pageUrl) {
    const script = `${control.getAttribute('href') || ''} ${control.getAttribute('onclick') || ''}`;
    const postback = script.match(POSTBACK_PATTERN);
    if (postback) {
      const form = findPostbackForm(control);
      if (form) return { kind: 'postback', form, pageUrl, target: postback[1], argument: postback[2] };
    }

    if (isSubmitButton(control) && control.form) {
      return { kind: 'submit', form: control.form, submitter: control, pageUrl };
    }

    if (control.tagName === 'A') {
      const href = control.getAttribute('href');
      const isRealLink = href && !href.startsWith('#') && !/^javascript:/i.test(href);
      if (isRealLink) {
        const url = new URL(href, pageUrl);
        if (url.origin !== new URL(pageUrl).origin) return { kind: 'unsupported' };
        if (withoutHash(url.href) !== withoutHash(pageUrl)) return { kind: 'link', url: url.href };
      }
    }

    return { kind: 'click' };
  }

  function isSubmitButton(element) {
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (element.tagName === 'INPUT') return type === 'submit' || type === 'image';
    // A <button> inside a form submits it unless told otherwise.
    return element.tagName === 'BUTTON' && (type === '' || type === 'submit') && !element.getAttribute('onclick');
  }

  /** ASP.NET pages have one big form holding the page state (__VIEWSTATE). */
  function findPostbackForm(control) {
    const doc = control.ownerDocument;
    const viewState = doc.querySelector('input[name="__VIEWSTATE"]');
    return control.closest('form') || (viewState && viewState.form) || doc.forms[0] || null;
  }

  function withoutHash(url) {
    return url.split('#')[0];
  }

  // ---------------------------------------------------------------------------
  // Loading a page in the background
  // ---------------------------------------------------------------------------

  /**
   * Loads the page a control would open and returns { document, url }.
   * Only for 'link', 'postback' and 'submit' controls.
   */
  async function loadPage(action) {
    const request = action.kind === 'link' ? { url: action.url, init: { method: 'GET' } } : buildFormRequest(action);

    const response = await fetch(request.url, { credentials: 'include', redirect: 'follow', ...request.init });
    if (!response.ok) {
      throw new Error(`The website answered "${response.status} ${response.statusText}" when loading the next page.`);
    }

    const html = decodeHtml(await response.arrayBuffer(), response.headers.get('content-type'));
    return {
      document: new DOMParser().parseFromString(html, 'text/html'),
      url: response.url,
    };
  }

  /** Builds the same request the browser would send when the form is submitted. */
  function buildFormRequest(action) {
    const { form, submitter, pageUrl } = action;
    const fields = submitter ? new FormData(form, submitter) : new FormData(form);

    if (action.kind === 'postback') {
      fields.set('__EVENTTARGET', action.target);
      fields.set('__EVENTARGUMENT', action.argument);
    }

    const url = new URL(form.getAttribute('action') || pageUrl, pageUrl);
    const method = (form.getAttribute('method') || 'get').toUpperCase();

    if (method === 'GET') {
      for (const [name, value] of fields) url.searchParams.set(name, value);
      return { url: url.href, init: { method: 'GET' } };
    }

    const isMultipart = (form.getAttribute('enctype') || '').toLowerCase() === 'multipart/form-data';
    return {
      url: url.href,
      init: { method: 'POST', body: isMultipart ? fields : new URLSearchParams(fields) },
    };
  }

  /**
   * Turns the downloaded bytes into text using the page's character set,
   * so non-English text (Hindi, Chinese, accented letters) isn't garbled.
   */
  function decodeHtml(bytes, contentType) {
    let charset = (/charset=["']?([\w-]+)/i.exec(contentType || '') || [])[1];

    if (!charset) {
      const start = new TextDecoder('windows-1252').decode(bytes.slice(0, 4096));
      charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(start) || [])[1];
    }

    try {
      return new TextDecoder(charset || 'utf-8').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes); // unknown charset name
    }
  }

  globalThis.GridGrab = Object.assign(globalThis.GridGrab, { describeControl, loadPage });
})();
