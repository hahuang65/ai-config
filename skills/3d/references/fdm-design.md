# FDM Design Guidance

Apply this guidance when designing a part for Fused Deposition Modeling (FDM), where a printer builds the part in layers from melted filament.
Treat values below as starting assumptions, not universal proof.

## Dimension authority

Use this order of authority:

1. The user's direct measurement of the actual mating object.
2. A manufacturer drawing, standard, or datasheet for the exact revision.
3. Multiple reliable secondary sources that agree.
4. An explicit provisional assumption that needs a fit test.

Record the source beside each critical parameter in the model source and model review sheet.
Cite a URL, document title, standard, or “user measurement” rather than writing “online dimensions.”
When sources conflict, report the values and resolve the conflict with the user before geometry depends on one.
Never hide a guess inside fit clearance.

Research real-world dimensions when the part mates with a product, fastener, connector, bearing, magnet, PCB, vehicle, or standardized system.
Cross-check high-consequence dimensions.

## Printer and material assumptions

Ask for printer details only when build volume, nozzle, process accuracy, enclosure, or material capability can change geometry or feasibility.
If those details do not change geometry, state these defaults and continue:

- 0.4 mm nozzle.
- 0.20 mm layer height.
- PLA.

Material selection must follow the part's environment and load.
Do not recommend PLA for sustained load, high heat, outdoor ultraviolet exposure, or impact when creep, softening, or brittleness is a concern.
Call out skin, food, electrical, or safety-critical use rather than making an unsupported safety claim.

## Parameterized source

Put user-adjustable dimensions together near the top of the source.
Use precise names and source comments, and express dimensions in millimetres.
Separate fixed standard dimensions from printer calibration and user preferences.
Avoid magic numbers in geometry operations.

For new CadQuery work:

- Place the intended print-bed face at a predictable zero plane.
- Prefer robust solids and explicit boolean operations over fragile operation chains.
- Apply finishing operations only after the functional geometry they depend on is stable.
- Fail visibly when a requested radius, wall, or boolean cannot produce valid geometry.
- Export STL for slicing and STEP when editable boundary representation is useful.

For existing OpenSCAD work, preserve its module, parameter, export, and rendering conventions.
Do not rewrite it into CadQuery.

## Print-oriented geometry

Design around the intended orientation from the start.
Prefer a stable bed face, short bridges, self-supporting chamfers, and load paths that do not split weak layer bonds.
Do not treat one universal overhang angle as proof; material, cooling, bridge direction, wall thickness, and printer calibration matter.

Make fit clearance a named parameter.
Base it on interface type, material, process, and calibration, then recommend a coupon when fit matters.
A generic starting point for ordinary moving or slip fits is not a substitute for the user's calibrated clearance.

Check at least:

- Minimum walls, pins, clips, and text strokes against nozzle and load.
- Hole and fastener access, including tool clearance.
- Captured hardware insertion and assembly order.
- Unsupported ceilings, bridges, steep downward faces, and trapped support material.
- Sharp internal corners and stress concentrations.
- Part orientation against primary loads and likely creep.
- Build-volume fit for every exported part.
- Clearance between multipart components in their printed orientation.

## Computed evidence

Run the smallest available checks that establish relevant model facts.
Depending on local tools, this can include:

- CAD script completes without errors.
- The result contains the expected number of solids.
- Bounding dimensions match expected values within a stated tolerance.
- Volume is positive and plausible.
- STL files exist and are non-empty.
- Each printable mesh is finite and watertight.
- Named wall, floor, clearance, or hole constraints satisfy their configured limits.
- Final renders show every critical interface from a useful angle.

A check that was not run is “not checked,” not “passed.”
A missing validator or render blocks only the claim it would support, but the workflow must report the gap before approval.

## Physical validation

Computed evidence does not prove:

- Fit against the real object.
- Fastener seating or assembly feel.
- Strength, fatigue life, impact resistance, or safe working load.
- Creep under sustained load.
- Heat, ultraviolet, chemical, moisture, or weather durability.
- Slicer-specific support and bridging quality.
- Printer calibration or dimensional accuracy.

For a tight interface, design a small fit coupon or a cut-down test section before the full print.
For a load-bearing part, print a representative prototype in the intended material and orientation, then test it under a conservative load before calling it production-ready.
For multipart mechanisms, test the joint or latch independently when practical.
Record test results only after the user reports or supplies that physical evidence.

## Delivery guidance

Give a concise print recipe that includes only choices important to this part: material, layer height, walls, infill, supports, orientation, and quantity.
Explain the geometry-specific reason for deviations from the slicer's normal profile.
End with the key adjustable parameters and invite targeted changes.
