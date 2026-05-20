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

namespace local_coursetags\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use moodle_url;

/**
 * External function: return visible tags for a set of course IDs.
 *
 * A single DB query fetches tags for all requested courses at once. Courses with
 * no tags are omitted from the result. Tags with flag < 0 (hidden by admin) are
 * excluded. No per-course capability check is needed because the course IDs come
 * from elements already rendered on the page the user is viewing.
 *
 * @package    local_coursetags
 * @copyright  2026 Your Name
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_course_tags extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseids' => new external_multiple_structure(
                new external_value(PARAM_INT, 'Course ID'),
                'Array of course IDs'
            ),
        ]);
    }

    /**
     * Return visible tags for the requested courses.
     *
     * @param  int[] $courseids
     * @return array[]
     */
    public static function execute(array $courseids): array {
        global $DB;

        $params    = self::validate_parameters(self::execute_parameters(), ['courseids' => $courseids]);
        $courseids = array_values(array_unique(array_map('intval', $params['courseids'])));

        if (empty($courseids)) {
            return [];
        }

        // Cap to 200 IDs per call to prevent accidental large queries.
        $courseids = array_slice($courseids, 0, 200);

        // One query for all requested courses.
        // tag.flag: 0 = normal, >0 = flagged (still visible), -1 = hidden by admin.
        // We exclude flag = -1 to respect admin visibility decisions.
        [$insql, $inparams] = $DB->get_in_or_equal($courseids, SQL_PARAMS_NAMED);

        $sql = "SELECT ti.itemid AS courseid,
                       t.id,
                       t.name,
                       t.rawname
                  FROM {tag} t
                  JOIN {tag_instance} ti ON ti.tagid = t.id
                  JOIN {course} c        ON c.id     = ti.itemid
                 WHERE ti.component = 'core'
                   AND ti.itemtype  = 'course'
                   AND ti.itemid    $insql
                   AND t.flag       >= 0
              ORDER BY ti.itemid, ti.ordering ASC, t.name ASC";

        $records = $DB->get_records_sql($sql, $inparams);

        // Group by course ID.
        $tagsbycourse = [];
        foreach ($records as $rec) {
            $cid = (int) $rec->courseid;
            $tagsbycourse[$cid][] = [
                'id'      => (int) $rec->id,
                'name'    => $rec->name,
                'rawname' => $rec->rawname,
                'tagurl'  => (new moodle_url('/tag/index.php', ['id' => $rec->id]))->out(false),
            ];
        }

        $result = [];
        foreach ($tagsbycourse as $cid => $tags) {
            $result[] = [
                'courseid' => $cid,
                'tags'     => $tags,
            ];
        }

        return $result;
    }

    /**
     * @return external_multiple_structure
     */
    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(
            new external_single_structure([
                'courseid' => new external_value(PARAM_INT, 'Course ID'),
                'tags'     => new external_multiple_structure(
                    new external_single_structure([
                        'id'      => new external_value(PARAM_INT,  'Tag ID'),
                        'name'    => new external_value(PARAM_TEXT, 'Normalised tag name'),
                        'rawname' => new external_value(PARAM_TEXT, 'Display tag name'),
                        'tagurl'  => new external_value(PARAM_URL,  'Tag index page URL'),
                    ])
                ),
            ])
        );
    }
}
