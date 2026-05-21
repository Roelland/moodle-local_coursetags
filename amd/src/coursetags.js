// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * AMD module for local_coursetags.
 *
 * On page load:
 *  1. Collects course elements for the current page.
 *  2. Fetches all their tags in one AJAX call.
 *  3. Injects badge rows and a filter bar into the action toolbar.
 *  4. Silently pre-fetches course elements from every other paginated page
 *     and appends them (hidden) to the grid. When a tag filter is active,
 *     matching courses from ALL pages are revealed and pagination is hidden.
 *     Clearing the filter restores the original single-page view.
 *
 * @module     local_coursetags/coursetags
 * @copyright  2026 Your Name
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';
import Templates from 'core/templates';

const SELECTORS = {
    BOOST_UNION: '[data-region="course-content"][data-course-id]',
    STANDARD: '.coursebox[data-courseid]',
};

const getInjectionTarget = (el) => {
    const cardBody = el.querySelector('.course-info-container');
    if (cardBody) {
        return {element: cardBody, position: 'beforeend'};
    }
    const courseName = el.querySelector('.aalink.coursename');
    if (courseName) {
        return {element: courseName, position: 'afterend'};
    }
    const summary = el.querySelector('.content .summary');
    if (summary) {
        return {element: summary, position: 'afterend'};
    }
    return {element: el, position: 'beforeend'};
};

// ── Module-level state ────────────────────────────────────────────────────────
let courseElements   = new Map(); // courseId → HTMLElement
const activeTags     = new Set(); // lowercase keys currently filtering
const courseTagMap   = new Map(); // courseId → Set<string (lowercase)>
const tagIndex       = new Map(); // lowercase key → display rawname
let allTagNames      = [];        // [[key, rawname], ...] sorted; updated when extra pages load

let extraPagesLoaded    = false;
let extraPageLoadPromise = null;

// ── Filtering ─────────────────────────────────────────────────────────────────

const filterCourses = () => {
    courseElements.forEach((el, courseId) => {
        if (activeTags.size === 0) {
            // No active filter: hide extra-page courses, show current-page courses.
            if (el.dataset.extraPage) {
                el.classList.add('local-coursetags-hidden');
            } else {
                el.classList.remove('local-coursetags-hidden');
            }
            return;
        }
        const tags   = courseTagMap.get(courseId) ?? new Set();
        const passes = [...activeTags].every(k => tags.has(k));
        el.classList.toggle('local-coursetags-hidden', !passes);
    });

    // Toggle a body class so the CSS rule hides all .pagination elements.
    document.body.classList.toggle('local-coursetags-filtering', activeTags.size > 0);
};

const rebuildTagNames = () => {
    allTagNames.length = 0;
    allTagNames.push(...[...tagIndex.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

// ── Background loading of other pages ────────────────────────────────────────

const loadExtraPages = () => {
    if (extraPagesLoaded) {
        return Promise.resolve();
    }
    if (extraPageLoadPromise) {
        return extraPageLoadPromise;
    }

    // Collect numbered page links that are not the currently active page.
    const pageLinks = [
        ...document.querySelectorAll('.pagination .page-item:not(.active) .page-link[href]'),
    ]
        .filter(a => /^\d+$/.test(a.textContent.trim()))
        .map(a => a.href);

    if (!pageLinks.length) {
        extraPagesLoaded = true;
        return Promise.resolve();
    }

    // Prefer a known Moodle/Boost Union courses container; fall back to the
    // parent element of the first known course element.
    const container = document.querySelector(
        '.courses, [data-region="course-list-content"], .course-listing-content'
    ) ?? [...courseElements.values()][0]?.parentElement ?? null;

    if (!container) {
        extraPagesLoaded = true;
        return Promise.resolve();
    }

    extraPageLoadPromise = (async() => {
        const newCourseIds = [];

        // Fetch all other pages in parallel.
        await Promise.all(pageLinks.map(async(url) => {
            try {
                const resp = await fetch(url, {credentials: 'same-origin'});
                const html = await resp.text();
                const doc  = new DOMParser().parseFromString(html, 'text/html');

                const els = [
                    ...doc.querySelectorAll(SELECTORS.BOOST_UNION),
                    ...doc.querySelectorAll(SELECTORS.STANDARD),
                ];

                els.forEach(el => {
                    const id = parseInt(el.dataset.courseId || el.dataset.courseid, 10);
                    if (!id || courseElements.has(id)) {
                        return;
                    }

                    // Clone the immediate wrapper (col-*, li) if present so the
                    // card/row fits the target grid or list structure.
                    const parent  = el.parentElement;
                    const useWrap = parent && (
                        parent.tagName === 'LI' ||
                        parent.className?.split(' ').some(c => c.startsWith('col'))
                    );
                    const clone   = (useWrap ? parent : el).cloneNode(true);

                    // Locate the actual course element inside the clone.
                    const courseEl = useWrap
                        ? (clone.querySelector(SELECTORS.BOOST_UNION)
                            || clone.querySelector(SELECTORS.STANDARD)
                            || clone)
                        : clone;

                    courseEl.classList.add('local-coursetags-hidden');
                    courseEl.dataset.extraPage = 'true';
                    container.appendChild(clone);
                    courseElements.set(id, courseEl);
                    newCourseIds.push(id);
                });
            } catch(e) {
                window.console?.warn('local_coursetags: failed to load extra page', url, e);
            }
        }));

        // Fetch tags for the newly discovered courses.
        if (newCourseIds.length) {
            try {
                const newResults = await Ajax.call([{
                    methodname: 'local_coursetags_get_course_tags',
                    args: {courseids: newCourseIds},
                }])[0];

                for (const d of newResults) {
                    if (!d.tags?.length) {
                        continue;
                    }
                    const el = courseElements.get(d.courseid);
                    if (!el) {
                        continue;
                    }

                    const tagSet = new Set();
                    for (const tag of d.tags) {
                        const key = tag.rawname.toLowerCase();
                        tagSet.add(key);
                        if (!tagIndex.has(key)) {
                            tagIndex.set(key, tag.rawname);
                        }
                    }
                    courseTagMap.set(d.courseid, tagSet);

                    // Inject badge row into the cloned card.
                    try {
                        const {html} = await Templates.renderForPromise(
                            'local_coursetags/coursetags',
                            {tags: d.tags}
                        );
                        const {element: target, position} = getInjectionTarget(el);
                        target.insertAdjacentHTML(position, html);
                    } catch(e) { /* badge injection is non-critical */ }
                }

                // Refresh the typeahead list with any newly discovered tags.
                rebuildTagNames();
            } catch(e) {
                window.console?.warn('local_coursetags: extra page tag fetch error', e);
            }
        }

        extraPagesLoaded = true;
    })();

    return extraPageLoadPromise;
};

// ── Active tag chips ──────────────────────────────────────────────────────────

const addActiveTag = (rawname, activeContainer) => {
    const key = rawname.toLowerCase();
    if (activeTags.has(key)) {
        return;
    }
    activeTags.add(key);

    const chip = document.createElement('span');
    chip.className      = 'local-coursetags-filter-chip badge rounded-pill';
    chip.dataset.tagKey = key;
    chip.appendChild(document.createTextNode(rawname + ' '));

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'local-coursetags-filter-remove';
    btn.setAttribute('aria-label', `Remove filter: ${rawname}`);
    btn.textContent = '×';
    btn.addEventListener('click', () => {
        activeTags.delete(key);
        chip.remove();
        filterCourses();
        activeContainer.hidden = (activeTags.size === 0);
    });

    chip.appendChild(btn);
    activeContainer.appendChild(chip);
    activeContainer.hidden = false;

    // Wait for extra pages to finish loading, then apply the filter.
    // loadExtraPages() is a no-op if already done.
    loadExtraPages().then(() => filterCourses());
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const init = async() => {
    // ── 1. Collect current-page course elements ───────────────────────────────
    document.querySelectorAll(SELECTORS.BOOST_UNION).forEach((el) => {
        const id = parseInt(el.dataset.courseId, 10);
        if (id) {
            courseElements.set(id, el);
        }
    });
    document.querySelectorAll(SELECTORS.STANDARD).forEach((el) => {
        const id = parseInt(el.dataset.courseid, 10);
        if (id && !courseElements.has(id)) {
            courseElements.set(id, el);
        }
    });

    if (!courseElements.size) {
        return;
    }

    // ── 2. Fetch tags for current-page courses ────────────────────────────────
    let results;
    try {
        results = await Ajax.call([{
            methodname: 'local_coursetags_get_course_tags',
            args: {courseids: [...courseElements.keys()]},
        }])[0];
    } catch(e) {
        window.console?.warn('local_coursetags: AJAX error', e);
        return;
    }

    // ── 3. Build lookup structures ────────────────────────────────────────────
    for (const courseData of results) {
        if (!courseData.tags?.length) {
            continue;
        }
        const tagSet = new Set();
        for (const tag of courseData.tags) {
            const key = tag.rawname.toLowerCase();
            tagSet.add(key);
            if (!tagIndex.has(key)) {
                tagIndex.set(key, tag.rawname);
            }
        }
        courseTagMap.set(courseData.courseid, tagSet);
    }

    rebuildTagNames();

    // ── 4. Inject badge rows onto current-page courses ────────────────────────
    for (const courseData of results) {
        if (!courseData.tags?.length) {
            continue;
        }
        const el = courseElements.get(courseData.courseid);
        if (!el) {
            continue;
        }
        try {
            const {html} = await Templates.renderForPromise(
                'local_coursetags/coursetags',
                {tags: courseData.tags}
            );
            const {element: target, position} = getInjectionTarget(el);
            target.insertAdjacentHTML(position, html);
        } catch(e) {
            window.console?.warn('local_coursetags: render error', courseData.courseid, e);
        }
    }

    // ── 5. Inject filter UI ───────────────────────────────────────────────────
    if (!tagIndex.size) {
        return;
    }

    let inputWrap;
    try {
        const {html} = await Templates.renderForPromise('local_coursetags/filterbar', {});
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        inputWrap = wrap.firstElementChild;
    } catch(e) {
        window.console?.warn('local_coursetags: filterbar render error', e);
        return;
    }

    const activeContainer = document.createElement('div');
    activeContainer.className = 'local-coursetags-active';
    activeContainer.setAttribute('aria-live', 'polite');
    activeContainer.hidden = true;

    const actionBar = document.querySelector('#action_bar');
    const flexRow   = actionBar?.querySelector('.d-flex');

    if (flexRow) {
        flexRow.appendChild(inputWrap);
        actionBar.appendChild(activeContainer);
    } else {
        const firstEl = [...courseElements.values()][0];
        const fallbackBar = document.createElement('div');
        fallbackBar.className = 'local-coursetags-filterbar';
        fallbackBar.appendChild(inputWrap);
        fallbackBar.appendChild(activeContainer);
        firstEl.parentElement.insertBefore(fallbackBar, firstEl);
    }

    const input       = inputWrap.querySelector('.local-coursetags-input');
    const suggestions = inputWrap.querySelector('.local-coursetags-suggestions');

    // ── 6. Typeahead ──────────────────────────────────────────────────────────
    let highlightedIndex = -1;

    const showSuggestions = (matches) => {
        suggestions.innerHTML = '';
        highlightedIndex = -1;
        if (!matches.length) {
            suggestions.hidden = true;
            return;
        }
        matches.forEach(([key, rawname]) => {
            const li = document.createElement('li');
            li.dataset.key = key;
            li.textContent = rawname;
            li.setAttribute('role', 'option');
            suggestions.appendChild(li);
        });
        suggestions.hidden = false;
    };

    const selectSuggestion = (li) => {
        if (!li) {
            return;
        }
        const rawname = tagIndex.get(li.dataset.key);
        if (rawname) {
            addActiveTag(rawname, activeContainer);
        }
        input.value = '';
        suggestions.hidden = true;
        highlightedIndex = -1;
        input.focus();
    };

    input.addEventListener('focus', () => {
        if (!input.value.trim()) {
            showSuggestions(allTagNames);
        }
    });

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            showSuggestions(allTagNames);
            return;
        }
        showSuggestions(allTagNames.filter(([k]) => k.includes(q)).slice(0, 8));
    });

    input.addEventListener('keydown', (e) => {
        const items = [...suggestions.querySelectorAll('li')];
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            items.forEach((li, i) => li.classList.toggle('active', i === highlightedIndex));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, -1);
            items.forEach((li, i) => li.classList.toggle('active', i === highlightedIndex));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            selectSuggestion(highlightedIndex >= 0 ? items[highlightedIndex] : items[0]);
        } else if (e.key === 'Escape') {
            suggestions.hidden = true;
            highlightedIndex = -1;
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestions.hidden = true;
            highlightedIndex = -1;
        }, 150);
    });

    suggestions.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li');
        if (li) {
            e.preventDefault();
            selectSuggestion(li);
        }
    });

    // ── 7. Click badge on course card → add to filter ─────────────────────────
    document.addEventListener('click', (e) => {
        const badge = e.target.closest('.local-coursetags-badge');
        if (!badge) {
            return;
        }
        e.preventDefault();
        const rawname = badge.title || badge.textContent.trim();
        if (rawname) {
            addActiveTag(rawname, activeContainer);
        }
    });

    // ── 8. Pre-load other pages in the background ─────────────────────────────
    // Start immediately so the data is likely ready by the time the user picks
    // a filter. loadExtraPages() is idempotent.
    loadExtraPages();
};
