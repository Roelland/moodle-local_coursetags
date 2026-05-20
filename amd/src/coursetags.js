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
 * Scans the page for rendered course elements, fetches their tags via a single
 * AJAX call, and injects a badge row into each element that has tags.
 *
 * Supported rendering modes
 * ─────────────────────────
 *  • Boost Union card view:   [data-region="course-content"][data-course-id]
 *  • Boost Union list view:   same selector, different inner structure
 *  • Standard Moodle view:    .coursebox[data-courseid]   (no hyphen)
 *
 * The AMD module is only loaded on pages where a course listing is rendered
 * (controlled by the PHP hook callback in classes/hook/callbacks.php).
 *
 * Build note
 * ──────────
 * Run `grunt amd` from the Moodle root to create amd/build/coursetags.min.js.
 * During development add `$CFG->cachejs = false;` to config.php to use this
 * source file directly without building.
 *
 * @module     local_coursetags/coursetags
 * @copyright  2026 Your Name
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';
import Templates from 'core/templates';

// CSS selectors for finding course elements in both rendering modes.
const SELECTORS = {
    // Boost Union modified mode — card and list presentation.
    // data-course-id (hyphenated) → dataset.courseId in JS.
    BOOST_UNION: '[data-region="course-content"][data-course-id]',

    // Standard core_course_renderer (Boost Union NOCHANGE setting, or no theme override).
    // data-courseid (no hyphen) → dataset.courseid in JS.
    STANDARD: '.coursebox[data-courseid]',
};

/**
 * Determine where inside a course element to insert the tag row.
 *
 * Returns the target node and an insertAdjacentHTML position string so the
 * caller can write: target.insertAdjacentHTML(position, html).
 *
 * @param  {HTMLElement} courseElement
 * @return {{element: HTMLElement, position: string}}
 */
const getInjectionTarget = (courseElement) => {
    // Boost Union card mode: append inside .course-info-container (the card-body).
    // This places tags below the course name and category line.
    const cardBody = courseElement.querySelector('.course-info-container');
    if (cardBody) {
        return {element: cardBody, position: 'beforeend'};
    }

    // Boost Union list mode: insert after the course name anchor.
    // The name sits inside a d-flex flex-column column; afterend keeps flow correct.
    const courseName = courseElement.querySelector('.aalink.coursename');
    if (courseName) {
        return {element: courseName, position: 'afterend'};
    }

    // Standard core_course_renderer: insert after the .summary div.
    const summary = courseElement.querySelector('.content .summary');
    if (summary) {
        return {element: summary, position: 'afterend'};
    }

    // Fallback for any other layout.
    return {element: courseElement, position: 'beforeend'};
};

/**
 * Entry point called by js_call_amd('local_coursetags/coursetags', 'init').
 *
 * @returns {Promise<void>}
 */
export const init = async() => {
    // Collect every course element on the page, keyed by course ID.
    // Using a Map deduplicates in case both selectors somehow match the same element.
    const courseElements = new Map();

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

    if (courseElements.size === 0) {
        return;
    }

    const courseIds = [...courseElements.keys()];

    // Single AJAX call for all visible courses.
    let results;
    try {
        results = await Ajax.call([{
            methodname: 'local_coursetags_get_course_tags',
            args: {courseids: courseIds},
        }])[0];
    } catch (e) {
        // Tags are a non-critical enhancement; absorb silently.
        window.console?.warn('local_coursetags: AJAX error', e);
        return;
    }

    // The template is compiled once by Moodle's template engine and cached, so
    // calling renderForPromise in a loop does not fire extra network requests
    // after the first invocation.
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
            window.console?.warn('local_coursetags: render error for course', courseData.courseid, e);
        }
    }
};
