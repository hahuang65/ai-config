# FDM design guidance

Fused Deposition Modeling (FDM) builds a part in layers from melted filament.
Treat the values below as starting assumptions, not universal proof.

## Dimension authority

Use this order of authority:

1. The user's direct measurement of the actual mating object.
2. A manufacturer drawing, standard, or datasheet for the exact revision.
3. Multiple reliable secondary sources that agree.
4. An explicit provisional assumption that needs a fit test.

Record the source beside each critical parameter in the model source and review sheet.
Cite a URL, document title, standard, or “user measurement,” not “online dimensions.”
When sources conflict, report the values and resolve the conflict before geometry depends on one.
Never hide a guess inside fit clearance.
Research dimensions when mating with a product, fastener, connector, bearing, magnet, PCB, vehicle, or standardized system.
Cross-check high-consequence dimensions, and report unavailable sources rather than inventing measurements.

## Printer and material assumptions

Ask about printer details when build volume, nozzle, process accuracy, enclosure, or material capability changes geometry or feasibility.
Otherwise state these defaults and continue:

- 0.4 mm nozzle.
- 0.20 mm layer height.
- PLA.

Material selection follows environment and load.
Do not recommend PLA for sustained load, high heat, outdoor ultraviolet exposure, or impact when creep, softening, or brittleness is a concern.
Call out skin, food, electrical, or safety-critical use rather than making unsupported safety claims.

## Parameterized source

Group user-adjustable dimensions near the top of the source, in millimetres, with precise names and source comments.
Separate fixed standard dimensions from printer calibration and preferences.
Avoid magic numbers in geometry operations.

For new CadQuery work:

- Place the intended print-bed face at a predictable zero plane.
- Prefer robust solids and explicit boolean operations over fragile operation chains.
- Apply finishing operations only after functional geometry is stable.
- Fail visibly when a radius, wall, or boolean cannot produce valid geometry.
- Export STL for slicing and STEP when editable boundary representation is useful.

For existing OpenSCAD work, preserve module, parameter, export, and rendering conventions.
Do not rewrite it into CadQuery.

## Print-oriented geometry

Design around orientation from the start.
Prefer a stable bed face, short bridges, self-supporting chamfers, and load paths that do not split weak layer bonds.
Do not treat one overhang angle as proof; material, cooling, bridge direction, wall thickness, and calibration matter.

Make fit clearance a named parameter based on interface type, material, process, and calibration.
Recommend a coupon when fit matters; generic moving or slip-fit values are not a substitute for calibrated clearance.

Check at least:

- Minimum walls, pins, clips, and text strokes against nozzle and load.
- Hole and fastener access, including tool clearance.
- Captured hardware insertion and assembly order.
- Unsupported ceilings, bridges, steep downward faces, and trapped support material.
- Sharp internal corners and stress concentrations.
- Orientation against primary loads and likely creep.
- Build-volume fit for every exported part.
- Clearance between multipart components in printed orientation.

## Computed evidence

Run the smallest available checks that establish relevant facts:

- CAD script completes without errors.
- The result contains the expected number of solids.
- Bounding dimensions match expected values within a stated tolerance.
- Volume is positive and plausible.
- STL files exist and are non-empty.
- Each printable mesh is finite and watertight.
- Named wall, floor, clearance, and hole constraints meet configured limits.
- Final renders show every critical interface from a useful angle.

A check not run is “not checked,” not “passed.”
Missing optional evidence blocks its supported claim and must be reported before approval.
Missing required tooling or renders and known generation, export, render, or mesh failures follow the blocking rules in the [workflow](workflow.md).
Do not downgrade required evidence to optional to finish a delivery.

## Physical validation

Computed evidence does not prove:

- Fit against the real object.
- Fastener seating or assembly feel.
- Strength, fatigue life, impact resistance, or safe working load.
- Creep under sustained load.
- Heat, ultraviolet, chemical, moisture, or weather durability.
- Slicer-specific support and bridging quality.
- Printer calibration or dimensional accuracy.

For a tight interface, design a small fit coupon or cut-down test section before the full print.
For a load-bearing part, print a representative prototype in the intended material and orientation and test under a conservative load before calling it production-ready.
For multipart mechanisms, test the joint or latch independently when practical.
Record results only after the user reports or supplies that physical evidence.
Never fabricate printer, slicer, CAD, or physical-test results.

## Delivery guidance

Give a concise print recipe with relevant material, layer height, walls, infill, supports, orientation, and quantity.
Explain geometry-specific deviations from the slicer's normal profile.
End with key adjustable parameters and invite targeted changes.
