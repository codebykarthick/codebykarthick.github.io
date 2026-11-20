import { LineSegments, Mesh, type BufferGeometry, type LineBasicMaterial, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Collects static geometry per material and merges it into one draw call each.
 * Transform geometry in place (translate/rotate) before adding. Call flush() once.
 */
export class StaticBatch {
  private readonly meshes = new Map<Material, BufferGeometry[]>();
  private readonly lines = new Map<LineBasicMaterial, BufferGeometry[]>();

  add(geometry: BufferGeometry, material: Material): void {
    const list = this.meshes.get(material) ?? [];
    list.push(geometry);
    this.meshes.set(material, list);
  }

  addLines(geometry: BufferGeometry, material: LineBasicMaterial): void {
    const list = this.lines.get(material) ?? [];
    list.push(geometry);
    this.lines.set(material, list);
  }

  flush(parent: Object3D): void {
    for (const [material, list] of this.meshes) parent.add(new Mesh(merge(list), material));
    for (const [material, list] of this.lines) parent.add(new LineSegments(merge(list), material));
    this.meshes.clear();
    this.lines.clear();
  }
}

function merge(list: BufferGeometry[]): BufferGeometry {
  if (list.length === 1) return list[0]!;
  const merged = mergeGeometries(list, false);
  if (!merged) throw new Error("StaticBatch: geometries have mismatched attributes");
  for (const g of list) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}
