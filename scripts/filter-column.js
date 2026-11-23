// The filter column element every page of this app uses. The shell draws the column from the page's filters.json, so a page
// holds only this element. The attribute is written in two parts on purpose: vendor/marinos/audit-filter-column.py reads a
// script as if it were a page, and would look for a filters.json beside this script.
const filterColumn = (name) => `<div class="search-side" data-filter-${'column'}="filters.json" data-filter-name="${name}"></div>`;

// A choice of one is radio buttons for a few options and a drop-down for a longer list, so the column does not grow with the list.
// Only the budget book and the year are a choice of one; everything else is a checkbox list.
const CHOICE_RADIOS = 3;
const choiceGroup = (id, label, values, def, param) => ({ type: values.length > CHOICE_RADIOS ? 'select' : 'radio', id, label, options: { values }, default: def, param });

module.exports = { filterColumn, choiceGroup };
