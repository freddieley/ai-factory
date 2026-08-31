# Engineering Core v1.1

The engineering core separates intent from execution.

## Requirements
Typed persistent requirements include category, value/unit, priority, verification method, and verification status.

## Plans
Plans contain assumptions, requirements, explicit ordered steps, and expected verification.

## Policy
Fusion operations are classified as `read`, `design`, `modify`, `export`, or `manufacture`. Manufacturing-related actions require explicit human approval before a future machine connector can dispatch them.

## Fusion links
An AI Factory project can be linked to a Fusion hub, Fusion project, and Fusion design. This prevents confusing local AI Factory UUIDs with Autodesk identifiers.

## Verification
Verification records store evidence and status against requirements and runs, forming the foundation for closed-loop engineering.
