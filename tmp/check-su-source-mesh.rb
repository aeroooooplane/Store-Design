# encoding: UTF-8
require 'json'
module StoreSplitMeshCheck
  ROOT=File.expand_path('../资源库/90_处理过程与审核/模型拆分/split-20260925-v2',__dir__)
  def self.run
    @model=Sketchup.active_model
    raise 'Wrong model' unless File.basename(@model.path)=='影石通用模型.skp'
    manifest=JSON.parse(File.read(File.join(ROOT,'manifest.json')))
    @cache={}; results=[]
    manifest['assets'].each do |a|
      @cache.clear
      GC.start
      e=@model.find_entity_by_persistent_id(a['pid'])
      bounds=Geom::BoundingBox.new; counters={faces:0,vertices:0,images:0}
      walk(e.definition,e.transformation,bounds,counters)
      # A definition-only save excludes the selected root instance's scale and material.
      # Save a temporary wrapper, then abort its operation; never save the source model.
      output=File.join(a['folder'],'prop-instance.skp')
      transform=e.transformation.to_a
      transform[12]=0.0;transform[13]=0.0;transform[14]=0.0
      begin
        @model.start_operation('Export isolated prop instance',true)
        wrapper=@model.definitions.add("AssetExport_#{a['pid']}")
        native_transform=Geom::Transformation.new(transform)
        identity=Geom::Transformation.new.to_a
        needs_precision_wrapper=native_transform.identity? && transform.zip(identity).any?{|x,y|(x-y).abs>1e-9}
        if needs_precision_wrapper
          helper=@model.definitions.add("AssetPrecisionHelper_#{a['pid']}")
          offset_transform=transform.dup;offset_transform[12]=1000.0
          instance=helper.entities.add_instance(e.definition,Geom::Transformation.new(offset_transform))
          outer=wrapper.entities.add_instance(helper,Geom::Transformation.translation([-1000.0,0,0]))
          outer.set_attribute('StoreAssetExport','precision_wrapper',true)
        else
          instance=wrapper.entities.add_instance(e.definition,native_transform)
        end
        instance.name="#{a['category']} - #{a['definition']}"
        instance.material=e.material if e.material
        raise "Instance SKP export failed: #{a['pid']}" unless wrapper.save_copy(output)
      ensure
        @model.abort_operation
      end
      row={asset_id:a['asset_id'],pid:a['pid'],tight_visible_face_bounds_m:[bounds.width,bounds.height,bounds.depth].map{|v|v.to_f*0.0254},min_m:bounds.min.to_a.map{|v|v*0.0254},max_m:bounds.max.to_a.map{|v|v*0.0254},counts:counters,instance_skp:'prop-instance.skp',instance_transform_without_translation:transform,root_material:e.material ? e.material.display_name : nil}
      results << row
      if e.material
        mat=e.material; tex=mat.texture
        row[:root_material_properties]={color:mat.color.to_a,alpha:mat.alpha.round(8),texture:tex ? [tex.image_width,tex.image_height,tex.width.to_f.round(8),tex.height.to_f.round(8)] : nil}
      end
      File.write(File.join(ROOT,'source-mesh-bounds.json'),JSON.pretty_generate({status:'running',checked:results.length,results:results}))
    end
    File.write(File.join(ROOT,'source-mesh-bounds.json'),JSON.pretty_generate({status:'complete',checked:results.length,results:results,note:'Visible face vertices and image corners traversed through nested transforms; excludes edges and hidden geometry, matching DAE options. Source model not saved.'}))
    puts "Tight source mesh check complete: #{results.length}"
  rescue => e
    File.write(File.join(ROOT,'source-mesh-error.txt'),"#{e.class}: #{e.message}\n#{e.backtrace.join("\n")}")
    raise
  ensure
    @cache.clear if @cache
  end
  def self.walk(definition,t,bounds,counters)
    data=@cache[definition.guid]
    unless data
      vertices={};faces=0;children=[];image_points=[];image_count=0
      definition.entities.each do |e|
        next if e.hidden? || !e.layer.visible?
        if e.is_a?(Sketchup::Face)
          faces+=1;e.vertices.each{|v|vertices[v.entityID]=v.position}
        elsif e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
          children << e
        elsif e.is_a?(Sketchup::Image)
          x=e.transformation.xaxis; x.length=e.width
          y=e.transformation.yaxis; y.length=e.height
          o=e.origin
          image_points.concat([o,o+x,o+y,o+x+y]);image_count+=1
        end
      end
      data={vertices:vertices.values+image_points,faces:faces,children:children,images:image_count};@cache[definition.guid]=data
    end
    data[:vertices].each{|v|bounds.add(v.transform(t))}
    counters[:vertices]+=data[:vertices].length;counters[:faces]+=data[:faces]
    counters[:images]+=data[:images]
    data[:children].each{|e|walk(e.definition,t*e.transformation,bounds,counters)}
  end
end
StoreSplitMeshCheck.run
