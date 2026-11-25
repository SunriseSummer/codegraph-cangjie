package codegraph_sync.core

import std.unittest.*
import std.unittest.testmacro.*

@Test
func linearScaleNormalizesProportionally(): Unit {
    @Expect(normalize(5.0, 0.0, 10.0), 0.5)
}
