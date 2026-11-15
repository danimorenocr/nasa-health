export default function Panel({ as: Tag = 'section', className = '', children, ...props }) {
  return (
    <Tag className={`glass-panel ${className}`} {...props}>
      {children}
    </Tag>
  )
}
