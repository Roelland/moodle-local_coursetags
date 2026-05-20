<?php
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

namespace local_coursetags\hook;

use core\hook\output\before_standard_top_of_body_html_generation;
use moodle_url;

/**
 * Hook callbacks for local_coursetags.
 *
 * @package    local_coursetags
 * @copyright  2026 Your Name
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class callbacks {

    /**
     * Register the AMD module on course-listing pages.
     *
     * Mirrors the page detection used by Boost Union's page_has_boostunion_modification(),
     * so the AMD module is active on exactly the same pages that show course cards.
     *
     * @param before_standard_top_of_body_html_generation $hook
     */
    public static function inject_amd(before_standard_top_of_body_html_generation $hook): void {
        global $PAGE;

        if (!self::is_course_listing_page()) {
            return;
        }

        $PAGE->requires->js_call_amd('local_coursetags/coursetags', 'init');
    }

    /**
     * Returns true when the current page shows a course listing.
     *
     * Covers: category index, site home, course search, and the AJAX sub-request
     * used when expanding a category on the category tree.
     */
    private static function is_course_listing_page(): bool {
        global $PAGE;

        // AJAX category-expansion sub-request.
        if ($PAGE->url->compare(new moodle_url('/course/category.ajax.php'), URL_MATCH_BASE)) {
            return true;
        }

        // Site home (context is the site course).
        $context = $PAGE->context;
        if ($context->contextlevel == CONTEXT_COURSE && $context->instanceid == SITEID) {
            return true;
        }

        // Static pages that render a category course listing.
        $listingpages = [
            '/course/index.php',
            '/course/search.php',
        ];

        foreach ($listingpages as $path) {
            if ($PAGE->url->compare(new moodle_url($path), URL_MATCH_BASE)) {
                return true;
            }
        }

        return false;
    }
}
