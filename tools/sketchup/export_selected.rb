# encoding: UTF-8
# Run in SketchUp 2022+ Ruby Console. Does not save/modify the source model.
require 'json'
require 'fileutils'
module InstaAssetExport
  # Portable: output travels with this script; no fixed drive letter required.
  ROOT = File.join(File.dirname(__FILE__), 'exports')
  def self.inventory
    model = Sketchup.active_model
    FileUtils.mkdir_p(ROOT)
    rows = model.definitions.reject { |d| d.image? }.map do |d|
      b = d.bounds
      {name: d.name, guid: d.guid, instances: d.instances.length,
       local_bounds_m: [b.width, b.height, b.depth].map { |v| v.to_f * 0.0254 },
       axis_note: 'SketchUp X/Y/Z; bounds in definition coordinates, instance scaling excluded'}
    end
    inventory_path = File.join(ROOT, "component-inventory-#{Time.now.strftime('%Y%m%d-%H%M%S')}-#{Process.pid}.json")
    raise 'Inventory output already exists; retry after one second.' if File.exist?(inventory_path)
    File.write(inventory_path, JSON.pretty_generate({source_model: model.path, sketchup_version: Sketchup.version,
      definitions: rows, note: 'Definition entries are not a list of complete props. Nested parts and unused definitions may be included.'}))
    puts "Indexed #{rows.length} component definitions: #{inventory_path}"
  end
  def self.export_selected
    model = Sketchup.active_model
    selection = model.selection.to_a
    unless selection.length == 1 && (selection[0].is_a?(Sketchup::ComponentInstance) || selection[0].is_a?(Sketchup::Group))
      raise 'Select exactly one prop component/group at model root.'
    end
    raise 'Exit component editing before export.' if model.active_path
    entity = selection[0]
    folder = File.join(ROOT, "selected-#{Time.now.strftime('%Y%m%d-%H%M%S')}")
    raise 'Output exists; retry after one second.' if File.exist?(folder)
    FileUtils.mkdir_p(folder)
    raise 'SKP copy export failed.' unless entity.definition.save_copy(File.join(folder, 'prop.skp'))
    ok = model.export(File.join(folder, 'prop.dae'), {selectionset_only: true, triangulated_faces: true, texture_maps: true, edges: false, hidden_geometry: false, preserve_instancing: true})
    raise 'DAE export failed.' unless ok
    b = entity.bounds
    local = entity.definition.bounds
    metadata = {source_model: model.path, sketchup_version: Sketchup.version, definition: entity.definition.name, guid: entity.definition.guid,
      instance_name: entity.name, instance_material: entity.material ? entity.material.display_name : nil,
      definition_bounds_m: [local.width,local.height,local.depth].map { |v| v.to_f * 0.0254 },
      world_bounds_m: [b.width,b.height,b.depth].map { |v| v.to_f * 0.0254 },
      transform: entity.transformation.to_a, style: nil,
      status: 'exported; scale/orientation/materials require visual verification',
      note: 'Bounds arrays are SketchUp X/Y/Z in metres, not labelled product width/depth/height. World bounds include rotation. Transform translations are inches. prop.skp is the definition without the selected instance transform; DAE may retain world placement. Normalize before GLB conversion.'}
    File.write(File.join(folder,'metadata.json'),JSON.pretty_generate(metadata))
    puts "Exported to #{folder}"
  end
end
puts 'Ready: InstaAssetExport.inventory ; InstaAssetExport.export_selected'
