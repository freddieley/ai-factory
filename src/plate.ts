import { fusion } from "./fusion.js";
import { withTimeout } from "./execution.js";
import { config } from "./config.js";
import { positiveMm,validatePlateHole } from "./geometry.js";
export type CreatePlateArgs={widthMm:number;depthMm:number;heightMm:number;holeDiameterMm:number;holeXmm?:number;holeYmm?:number};
export type PlateResult={success:boolean;operation:"create_plate_with_hole";dimensionsMm?:{width:number;depth:number;height:number};holeDiameterMm?:number;holeCenterMm?:{x:number;y:number};bodies?:number;document?:string;error?:string};
export function parseCreatePlateArgs(args:Record<string,unknown>):CreatePlateArgs{const widthMm=positiveMm(args.widthMm,"widthMm"),depthMm=positiveMm(args.depthMm,"depthMm"),heightMm=positiveMm(args.heightMm,"heightMm"),holeDiameterMm=positiveMm(args.holeDiameterMm,"holeDiameterMm");validatePlateHole(widthMm,depthMm,holeDiameterMm);const holeXmm=args.holeXmm===undefined?widthMm/2:positiveMm(args.holeXmm,"holeXmm"),holeYmm=args.holeYmm===undefined?depthMm/2:positiveMm(args.holeYmm,"holeYmm");if(holeXmm>=widthMm||holeYmm>=depthMm)throw new Error("Hole center must lie inside the plate.");if(holeXmm-holeDiameterMm/2<=0||holeXmm+holeDiameterMm/2>=widthMm||holeYmm-holeDiameterMm/2<=0||holeYmm+holeDiameterMm/2>=depthMm)throw new Error("Hole must leave material between its edge and the plate perimeter.");return{widthMm,depthMm,heightMm,holeDiameterMm,holeXmm,holeYmm};}
export function createPlateWithHoleScript(args:CreatePlateArgs){const w=args.widthMm/10,d=args.depthMm/10,h=args.heightMm/10,x=(args.holeXmm??args.widthMm/2)/10,y=(args.holeYmm??args.depthMm/2)/10,r=args.holeDiameterMm/20;return `import adsk.core, adsk.fusion
app = adsk.core.Application.get()
if not app: raise RuntimeError("Fusion application unavailable")
product = app.activeProduct
design = adsk.fusion.Design.cast(product)
if not design: raise RuntimeError("Active product is not a Fusion Design")
root = design.rootComponent
existingBodyCount = root.bRepBodies.count
plateSketch = root.sketches.add(root.xYConstructionPlane)
plateSketch.sketchCurves.sketchLines.addTwoPointRectangle(adsk.core.Point3D.create(0,0,0),adsk.core.Point3D.create(${w},${d},0))
extrudes = root.features.extrudeFeatures
plateInput = extrudes.createInput(plateSketch.profiles.item(0),adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
plateInput.setDistanceExtent(False,adsk.core.ValueInput.createByReal(${h}))
plate = extrudes.add(plateInput)
if not plate: raise RuntimeError("Plate extrusion failed")
body = root.bRepBodies.item(root.bRepBodies.count - 1)
topFace = None
for face in body.faces:
    box = face.boundingBox
    if box.maxPoint.z > ${h} - 1e-7 and box.minPoint.z > ${h} - 1e-7:
        topFace = face
        break
if not topFace: raise RuntimeError("Could not identify plate top face")
holeSketch = root.sketches.add(topFace)
holeSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(${x},${y},0),${r})
holeInput = extrudes.createInput(holeSketch.profiles.item(0),adsk.fusion.FeatureOperations.CutFeatureOperation)
holeInput.setThroughAllExtent(adsk.fusion.ThroughAllExtentDefinition.create())
holeCut = extrudes.add(holeInput)
if not holeCut: raise RuntimeError("Through-hole cut failed")
bodyCount = root.bRepBodies.count
if bodyCount - existingBodyCount != 1: raise RuntimeError("Expected one newly created plate body, got " + str(bodyCount-existingBodyCount))
finalBody = root.bRepBodies.item(bodyCount-1)
bbox = finalBody.boundingBox
print("AI_FACTORY_CAD_RESULT")
print("operation=create_plate_with_hole")
print("bodies=1")
print("width_mm=" + str((bbox.maxPoint.x-bbox.minPoint.x)*10.0))
print("depth_mm=" + str((bbox.maxPoint.y-bbox.minPoint.y)*10.0))
print("height_mm=" + str((bbox.maxPoint.z-bbox.minPoint.z)*10.0))
print("hole_diameter_mm=${args.holeDiameterMm}")
print("hole_x_mm=${args.holeXmm??args.widthMm/2}")
print("hole_y_mm=${args.holeYmm??args.depthMm/2}")
print("document=" + app.activeDocument.name)
`;}
function parseResult(result:unknown):PlateResult{const text=typeof result==="string"?result:JSON.stringify(result),body=text.match(/bodies=(\\d+)/)?.[1],width=text.match(/width_mm=([0-9.eE+-]+)/)?.[1],depth=text.match(/depth_mm=([0-9.eE+-]+)/)?.[1],height=text.match(/height_mm=([0-9.eE+-]+)/)?.[1],diameter=text.match(/hole_diameter_mm=([0-9.eE+-]+)/)?.[1],x=text.match(/hole_x_mm=([0-9.eE+-]+)/)?.[1],y=text.match(/hole_y_mm=([0-9.eE+-]+)/)?.[1],document=text.match(/document=([^\\"}\\r\\n]+)/)?.[1];if(!width||!depth||!height)return{success:false,operation:"create_plate_with_hole",error:`Fusion did not return verification dimensions: ${text}`};return{success:true,operation:"create_plate_with_hole",bodies:body?Number(body):undefined,dimensionsMm:{width:Number(width),depth:Number(depth),height:Number(height)},holeDiameterMm:diameter?Number(diameter):undefined,holeCenterMm:x&&y?{x:Number(x),y:Number(y)}:undefined,document};}
export async function executeCreatePlate(args:Record<string,unknown>):Promise<PlateResult>{const parsed=parseCreatePlateArgs(args);if(!fusion.isConnected())await fusion.connect();const result=await withTimeout(fusion.callTool("fusion_mcp_execute",{featureType:"script",object:{script:createPlateWithHoleScript(parsed)}}),config.TOOL_TIMEOUT_MS,"Fusion create plate with hole");return parseResult(result);}
