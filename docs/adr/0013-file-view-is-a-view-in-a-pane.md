# The File View is a View in a Pane

A file of the Project opens as a **File View**: a View inside a Pane, just like a Terminal. It is a preview by default; a double-click in the tree, the pin button or dragging the View makes it pinned. A Tab has at most one preview. A file already open in the Tab is focused and re-scrolled instead of opened twice. Content, scroll and Line selection are never saved; pinned File Views and their place in the layout are (ADR 0011).

We rejected keeping the reader inside the Files browser sidebar: a file the user wants to read belongs beside the Terminal that produced it, and a Pane can be split, stacked and restored. We also rejected editing or reverting from the reader; the escape hatch is "open outside Timmy".
