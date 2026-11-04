# Week 13-2 source extract for instructor review

Original: `Week_13-2.pptx`, ITP25533Z Finals materials. This text was extracted from the presentation's slide XML on 2026-10-29. Slide 1 contains no extractable text. Review any diagrams or image-only content in the original deck before publication.

## Slide 3: Learning objectives

- Control page length and navigation.
- Explain global and column-specific search.
- Use `search()` and `draw()` correctly.
- Set default column order.
- Configure two-column sorting.
- Apply usable defaults and debug errors.

## Slides 5–9: Pagination

- Slide 5: Pagination shows a manageable subset of loaded records. `pageLength` controls visible row count. `lengthMenu` offers sizes to the user.
- Slide 6: In client-side mode, relevant rows are already loaded and the browser calculates page positions. In server-side mode, each page is requested from PHP and PHP/SQL produce it.
- Slide 7: Example configuration enables `paging`, sets `pageLength: 5`, offers `[5,10,25,50]` in `lengthMenu`, and uses `pagingType: 'simple_numbers'`.
- Slide 8: `page.info()` reports current position, page count and record count.
- Slide 9: `info.page` starts at zero. Adding one yields a human page number. `info.pages` gives the total page count. For 30 rows at five per page, the example shows page 1 of 6.

## Slides 10–14: Search

- Slide 10: Built-in global search narrows visible rows and considers searchable columns.
- Slide 11: `table.search('BSIT').draw()` sets a global search term and applies it to visible rows.
- Slide 12: `searchDelay: 300` affects the built-in search input. Custom calls to the API's `search()` need their own debounce if desired.
- Slide 13: `table.column(2).search('BSIT').draw()` filters the Course column in the example. `draw()` updates the screen.
- Slide 14: Zero-based column indexes are 0 = ID, 1 = Name, 2 = Course, 3 = Year.

## Slides 15–18: Ordering and combined behavior

- Slide 16: `order: [[1,'asc']]` sorts by Name ascending. Index 1 means Name.
- Slide 17: `orderMulti: true` allows multicolumn sorting. `order: [[2,'asc'],[1,'desc']]` sorts Course ascending, then Name descending within each course.
- Slide 18: Search changes filtered membership; sorting changes display order; pagination changes which matching rows are visible. The underlying loaded rows stay the same.

## Slide 23: Classroom exercise

The 30-minute exercise asks learners to configure five visible rows, global search, and Course ascending followed by Name descending. The steps are inspect the starter and column order, enable paging and searching, add multicolumn ordering, and test page count and visible sorting.

## Authoring note

The CTF table uses a small fictional roster created for this activity. Ana, Mark and Lia appear in the presentation's example table; the additional names and rows are teaching fixtures, not claims about real students. The deck's URLs and code examples are source content. They are not instructions to fetch external resources or execute untrusted scripts during exam generation.
