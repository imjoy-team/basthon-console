from graphviz import Digraph

g = Digraph('G')

g.edge('Hello', 'World')

display(g)

print(g.source)

# png download (svg is also supported)
g.render(filename='hello_world', format='png', scale=2)
