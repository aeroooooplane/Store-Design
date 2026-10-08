# encoding: UTF-8
require 'json'
require 'fileutils'
module StoreVariantFix
  ROOT=File.expand_path('../素材库/04_assets/incoming/split-20260925-v2',__dir__)
  def self.run
    model=Sketchup.active_model
    raise 'Wrong source' unless File.basename(model.path)=='影石通用模型.skp'
    path=File.join(ROOT,'manifest.json')
    m=JSON.parse(File.read(path));raise 'Batch still running' unless m['status']=='export_complete'
    original_selection=model.selection.to_a;original_root=InstaAssetExport::ROOT
    additions=[]
    m['assets'].each do |a|
      grouped=a['instances'].group_by do |instance|
        t=instance['transform'];c=[t[0,3],t[4,3],t[8,3]]
        c.flat_map{|x|c.map{|y|x.zip(y).sum{|u,v|u*v}.round(8)}}
      end.values
      next if grouped.length==1
      a['instances']=grouped.shift
      grouped.each do |instances|
        item=a.dup;item['instances']=instances;item['pid']=instances.first['pid'];item['asset_id']="asset-#{item['pid']}"
        e=model.find_entity_by_persistent_id(item['pid'])
        dir=File.join(ROOT,item['asset_id'])
        raise 'Variant output already exists' if File.exist?(dir)
        model.selection.clear;model.selection.add(e)
        InstaAssetExport.send(:remove_const,:ROOT);InstaAssetExport.const_set(:ROOT,dir)
        InstaAssetExport.export_selected
        item['folder']=Dir.glob(File.join(dir,'selected-*')).first
        e.definition.save_thumbnail(File.join(dir,'preview.png'))
        item['status']='exported_pending_validation'
        item['variant_note']='Separated by exact transform Gram matrix: retains original scale/shear differences.'
        additions << item
      end
    end
    unless additions.empty?
      FileUtils.cp(path,File.join(ROOT,'manifest-before-variant-correction.json'))
      m['assets'].concat(additions);m['completed']=m['assets'].length
      m['variant_correction']='Transform-axis accessors normalize axes; exact matrix Gram comparison found and separated one additional 1 mm width variant.'
      File.write(path,JSON.pretty_generate(m))
    end
    puts "Variant correction complete: #{m['assets'].length} assets"
  ensure
    if original_root
      InstaAssetExport.send(:remove_const,:ROOT);InstaAssetExport.const_set(:ROOT,original_root)
    end
    if original_selection
      model.selection.clear;model.selection.add(original_selection)
    end
  end
end
StoreVariantFix.run
load File.expand_path('check-su-source-mesh.rb',__dir__)
