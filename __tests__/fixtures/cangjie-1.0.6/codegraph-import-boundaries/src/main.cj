package codegraph_import_boundaries

import codegraph_import_boundaries.library.Widget as LibraryWidget
import codegraph_import_boundaries.other.Widget as OtherWidget
import codegraph_import_boundaries.library.makeLabel as libraryLabel
import codegraph_import_boundaries.other.makeLabel as otherLabel
import codegraph_import_boundaries.library

main(): Int64 {
    let first = LibraryWidget()
    let second = OtherWidget()
    first.identity()
    second.identity()
    LibraryWidget.named()
    libraryLabel()
    otherLabel()
    let version = library.VERSION
    println("import-boundaries: ${version}")
    directImportCheck()
    wildcardImportCheck()
    qualifiedImportCheck()
    reexportCheck()
    return 0
}
