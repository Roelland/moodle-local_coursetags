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
 *  1. Scans for course elements (Boost Union and standard renderer).
 *  2. Fetches all their tags in one AJAX call.
 *  3. Injects a badge row into each course element that has tags.
 *  4. Appends a tag filter input to #action_bar .d-flex (the category toolbar).
 *     Active filter chips appear as a row below the toolbar inside #action_bar.
 *     Falls back to injecting before the first course element when #action_bar
 *     is not present (non-Boost-Union pages).
 *  5. Clicking a course tag badge activates it as a filter.
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

// ── Filter state (module-level; init() is only ever called once) ──────────────
let courseElements = new Map();        // courseId (int) → HTMLElement
const activeTags   = new Set();        // lowercase keys currently filtering
const courseTagMap = new Map();        // courseId (int) → Set<string (lowercase)>
const tagIndex     = new Map();        // lowercase key → display rawname

const filterCourses = () => {
    courseElements.forEach((el, courseId) => {
        if (activeTags.size === 0) {
            el.classList.remove('local-coursetags-hidden');
            return;
        }
        const tags   = courseTagMap.get(courseId) ?? new Set();
        const passes = [...activeTags].every(k => tags.has(k));
        el.classList.toggle('local-coursetags-hidden', !passes);
    });
};

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
    filterCourses();
};

export const init = async() => {
    // ── 1. Collect course elements ────────────────────────────────────────────
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

    // ── 2. Fetch tags for all visible courses in one call ─────────────────────
    let results;
    try {
        results = await Ajax.call([{
            methodname: 'local_coursetags_get_course_tags',
            args: {courseids: [...courseElements.keys()]},
        }])[0];
    } catch (e) {
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

    // ── 4. Inject badge rows onto course elements ─────────────────────────────
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
        } catch (e) {
            window.console?.warn('local_coursetags: render error', courseData.courseid, e);
        }
    }

    // ── 5. Inject filter UI ───────────────────────────────────────────────────
    if (!tagIndex.size) {
        return;
    }

    // Render the input element from template.
    let inputWrap;
    try {
        const {html} = await Templates.renderForPromise('local_coursetags/filterbar', {});
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        inputWrap = wrap.firstElementChild;
    } catch (e) {
        window.console?.warn('local_coursetags: filterbar render error', e);
        return;
    }

    // Chips container is always created in JS (no template needed).
    const activeContainer = document.createElement('div');
    activeContainer.className = 'local-coursetags-active';
    activeContainer.setAttribute('aria-live', 'polite');
    activeContainer.hidden = true;

    // Primary target: append input to the #action_bar toolbar row,
    // chips row goes as a second row inside #action_bar.
    const actionBar = document.querySelector('#action_bar');
    const flexRow   = actionBar?.querySelector('.d-flex');

    if (flexRow) {
        flexRow.appendChild(inputWrap);
        actionBar.appendChild(activeContainer);
    } else {
        // Fallback for pages without #action_bar (standard renderer).
        const firstEl = [...courseElements.values()][0];
        const fallbackBar = document.createElement('div');
        fallbackBar.className = 'local-coursetags-filterbar';
        fallbackBar.appendChild(inputWrap);
        fallbackBar.appendChild(activeContainer);
        firstEl.parentElement.insertBefore(fallbackBar, firstEl);
    }

    const input       = inputWrap.querySelector('.local-coursetags-input');
    const suggestions = inputWrap.querySelector('.local-coursetags-suggestions');

    // Sorted list for typeahead: [[lowercase key, display rawname], ...]
    const allTagNames = [...tagIndex.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // ── 6. Typeahead behaviour ────────────────────────────────────────────────
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

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            suggestions.hidden = true;
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

    // Delay on blur so a mousedown on a suggestion fires first.
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

    // ── 7. Click tag badge on a course card → activate as filter ─────────────
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
};
