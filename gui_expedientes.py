#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Interfaz Gráfica para Robot de Búsqueda de Expedientes v6.2
TSJ Quintana Roo - Lista Electrónica

Permite agregar/eliminar expedientes y ejecutar búsquedas desde una GUI amigable
FIX v6.2: Usa rutas absolutas para evitar errores de permisos
"""

import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import json
import os
import subprocess
import threading
from datetime import datetime


class ExpedientesGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("🤖 Robot de Búsqueda de Expedientes TSJ QRoo v6.2")
        self.root.geometry("1000x700")
        self.root.resizable(True, True)

        # Archivo de expedientes - usar ruta absoluta basada en la ubicación del script
        # Esto evita problemas de permisos cuando se ejecuta desde diferentes directorios
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.archivo_json = os.path.join(script_dir, "expedientes.json")
        self.expedientes = []

        # Lista de juzgados/salas (ordenados por categoría)
        self.juzgados = self.obtener_lista_juzgados()

        # Cargar expedientes existentes
        self.cargar_expedientes()

        # Crear interfaz
        self.crear_interfaz()

        # Actualizar lista
        self.actualizar_lista_expedientes()

    def obtener_lista_juzgados(self):
        """Obtiene lista completa de juzgados y salas organizados"""
        return {
            "🏛️ SALAS DE SEGUNDA INSTANCIA": [
                "PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR",
                "SEGUNDA SALA PENAL ORAL",
                "TERCERA SALA PENAL ORAL",
                "CUARTA SALA CIVIL MERCANTIL Y FAMILIAR",
                "QUINTA SALA CIVIL MERCANTIL Y FAMILIAR",
                "SEXTA SALA CIVIL MERCANTIL Y FAMILIAR",
                "SEPTIMA SALA PENAL TRADICIONAL",
                "OCTAVA SALA PENAL ORAL",
                "NOVENA SALA PENAL ORAL",
                "DECIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA",
                "SALA CONSTITUCIONAL",
            ],
            "📍 CANCÚN - Familiar": [
                "JUZGADO PRIMERO FAMILIAR ORAL CANCUN",
                "JUZGADO SEGUNDO FAMILIAR ORAL CANCUN",
                "JUZGADO SEGUNDO DE LO FAMILIAR CANCUN",
                "JUZGADO FAMILIAR DE PRIMERA INSTANCIA CANCUN",
            ],
            "📍 CANCÚN - Civil": [
                "JUZGADO PRIMERO CIVIL CANCUN",
                "JUZGADO SEGUNDO CIVIL CANCUN",
                "JUZGADO TERCERO CIVIL CANCUN",
                "JUZGADO CUARTO CIVIL CANCUN",
                "JUZGADO ORAL CIVIL CANCUN",
            ],
            "📍 CANCÚN - Mercantil": [
                "JUZGADO PRIMERO MERCANTIL CANCUN",
                "JUZGADO SEGUNDO MERCANTIL CANCUN",
                "JUZGADO TERCERO MERCANTIL CANCUN",
                "JUZGADO ORAL MERCANTIL CANCUN",
            ],
            "📍 CANCÚN - Laboral": [
                "TRIBUNAL PRIMERO LABORAL CANCUN",
                "TRIBUNAL SEGUNDO LABORAL CANCUN",
            ],
            "📍 PLAYA DEL CARMEN": [
                "JUZGADO FAMILIAR ORAL PLAYA",
                "JUZGADO FAMILIAR PRIMERA INSTANCIA PLAYA",
                "JUZGADO PRIMERO CIVIL PLAYA",
                "JUZGADO SEGUNDO CIVIL PLAYA",
                "JUZGADO ORAL CIVIL PLAYA",
                "JUZGADO MERCANTIL PLAYA",
                "TRIBUNAL LABORAL PLAYA",
            ],
            "📍 CHETUMAL": [
                "JUZGADO FAMILIAR ORAL CHETUMAL",
                "JUZGADO FAMILIAR PRIMERA INSTANCIA CHETUMAL",
                "JUZGADO CIVIL CHETUMAL",
                "JUZGADO MERCANTIL CHETUMAL",
                "JUZGADO CIVIL ORAL CHETUMAL",
                "TRIBUNAL LABORAL CHETUMAL",
            ],
            "📍 OTROS MUNICIPIOS": [
                "JUZGADO FAMILIAR COZUMEL",
                "JUZGADO CIVIL COZUMEL",
                "JUZGADO FAMILIAR ORAL COZUMEL",
                "JUZGADO ORAL CIVIL COZUMEL",
                "JUZGADO CIVIL ORAL CARRILLO PUERTO",
                "JUZGADO FAMILIAR ORAL CARRILLO PUERTO",
                "JUZGADO CIVIL PRIMERA INSTANCIA CARRILLO PUERTO",
                "JUZGADO FAMILIAR PRIMERA INSTANCIA CARRILLO PUERTO",
                "JUZGADO CIVIL ORAL ISLA MUJERES",
                "JUZGADO FAMILIAR ORAL ISLA MUJERES",
                "JUZGADO CIVIL ORAL TULUM",
                "JUZGADO FAMILIAR ORAL TULUM",
                "JUZGADO FAMILIAR PRIMERA INSTANCIA BACALAR",
            ]
        }

    def crear_interfaz(self):
        """Crea todos los elementos de la interfaz"""

        # ========== FRAME SUPERIOR - TÍTULO ==========
        frame_titulo = tk.Frame(self.root, bg="#366092", height=60)
        frame_titulo.pack(fill=tk.X, padx=0, pady=0)

        titulo = tk.Label(
            frame_titulo,
            text="🤖 Robot de Búsqueda de Expedientes",
            font=("Arial", 18, "bold"),
            bg="#366092",
            fg="white"
        )
        titulo.pack(pady=10)

        subtitulo = tk.Label(
            frame_titulo,
            text="TSJ Quintana Roo - Estrados Electrónicos v6.1",
            font=("Arial", 10),
            bg="#366092",
            fg="white"
        )
        subtitulo.pack(pady=0)

        # ========== FRAME PRINCIPAL ==========
        frame_principal = tk.Frame(self.root)
        frame_principal.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Dividir en dos columnas: Formulario (izq) y Lista (der)
        frame_izquierda = tk.Frame(frame_principal)
        frame_izquierda.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 5))

        frame_derecha = tk.Frame(frame_principal)
        frame_derecha.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(5, 0))

        # ========== FORMULARIO (IZQUIERDA) ==========

        # Título del formulario
        tk.Label(
            frame_izquierda,
            text="➕ Agregar Nuevo Expediente",
            font=("Arial", 12, "bold")
        ).pack(anchor=tk.W, pady=(0, 10))

        # Tipo de búsqueda
        frame_tipo = tk.Frame(frame_izquierda)
        frame_tipo.pack(fill=tk.X, pady=5)

        tk.Label(frame_tipo, text="Tipo de búsqueda:", font=("Arial", 10)).pack(anchor=tk.W)

        self.tipo_busqueda = tk.StringVar(value="numero")

        frame_radio = tk.Frame(frame_tipo)
        frame_radio.pack(anchor=tk.W, pady=5)

        tk.Radiobutton(
            frame_radio,
            text="Por número de expediente",
            variable=self.tipo_busqueda,
            value="numero",
            command=self.cambiar_tipo_busqueda,
            font=("Arial", 9)
        ).pack(side=tk.LEFT, padx=(0, 10))

        tk.Radiobutton(
            frame_radio,
            text="Por nombre de actor/parte",
            variable=self.tipo_busqueda,
            value="nombre",
            command=self.cambiar_tipo_busqueda,
            font=("Arial", 9)
        ).pack(side=tk.LEFT)

        # Campo de texto (expediente o nombre)
        frame_texto = tk.Frame(frame_izquierda)
        frame_texto.pack(fill=tk.X, pady=5)

        self.label_texto = tk.Label(frame_texto, text="Número de expediente:", font=("Arial", 10))
        self.label_texto.pack(anchor=tk.W)

        self.entry_texto = tk.Entry(frame_texto, font=("Arial", 11), width=40)
        self.entry_texto.pack(fill=tk.X, pady=5)
        self.entry_texto.bind('<Return>', lambda e: self.agregar_expediente())

        # Ejemplo
        self.label_ejemplo = tk.Label(
            frame_texto,
            text="Ejemplo: 2358/2025",
            font=("Arial", 8),
            fg="gray"
        )
        self.label_ejemplo.pack(anchor=tk.W)

        # Juzgado/Sala
        frame_juzgado = tk.Frame(frame_izquierda)
        frame_juzgado.pack(fill=tk.X, pady=10)

        tk.Label(frame_juzgado, text="Juzgado/Sala:", font=("Arial", 10)).pack(anchor=tk.W)

        # Lista de juzgados con categorías
        self.combo_juzgado = ttk.Combobox(
            frame_juzgado,
            font=("Arial", 9),
            state="readonly",
            width=50
        )
        self.combo_juzgado.pack(fill=tk.X, pady=5)

        # Poblar combo con categorías
        opciones = []
        for categoria, juzgados in self.juzgados.items():
            opciones.append(categoria)  # Categoría como separador
            opciones.extend(juzgados)
            opciones.append("---")  # Separador visual

        self.combo_juzgado['values'] = opciones
        self.combo_juzgado.current(1)  # Seleccionar primer juzgado real

        # Comentario (opcional)
        frame_comentario = tk.Frame(frame_izquierda)
        frame_comentario.pack(fill=tk.X, pady=5)

        tk.Label(frame_comentario, text="Comentario (opcional):", font=("Arial", 10)).pack(anchor=tk.W)

        self.entry_comentario = tk.Entry(frame_comentario, font=("Arial", 9), width=40)
        self.entry_comentario.pack(fill=tk.X, pady=5)

        # Botones de acción
        frame_botones = tk.Frame(frame_izquierda)
        frame_botones.pack(fill=tk.X, pady=15)

        btn_agregar = tk.Button(
            frame_botones,
            text="➕ Agregar Expediente",
            command=self.agregar_expediente,
            bg="#4CAF50",
            fg="white",
            font=("Arial", 11, "bold"),
            padx=20,
            pady=10,
            cursor="hand2"
        )
        btn_agregar.pack(side=tk.LEFT, padx=(0, 5))

        btn_limpiar = tk.Button(
            frame_botones,
            text="🔄 Limpiar",
            command=self.limpiar_formulario,
            bg="#757575",
            fg="white",
            font=("Arial", 10),
            padx=15,
            pady=10,
            cursor="hand2"
        )
        btn_limpiar.pack(side=tk.LEFT)

        # ========== LISTA DE EXPEDIENTES (DERECHA) ==========

        # Título de la lista
        frame_titulo_lista = tk.Frame(frame_derecha)
        frame_titulo_lista.pack(fill=tk.X, pady=(0, 10))

        tk.Label(
            frame_titulo_lista,
            text="📋 Expedientes para Buscar",
            font=("Arial", 12, "bold")
        ).pack(side=tk.LEFT)

        self.label_contador = tk.Label(
            frame_titulo_lista,
            text=f"({len(self.expedientes)} expedientes)",
            font=("Arial", 10),
            fg="gray"
        )
        self.label_contador.pack(side=tk.LEFT, padx=10)

        # Treeview para lista de expedientes
        frame_tree = tk.Frame(frame_derecha)
        frame_tree.pack(fill=tk.BOTH, expand=True)

        # Scrollbar
        scrollbar = ttk.Scrollbar(frame_tree)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Treeview
        self.tree = ttk.Treeview(
            frame_tree,
            columns=("tipo", "busqueda", "juzgado"),
            show="headings",
            yscrollcommand=scrollbar.set,
            selectmode="browse"
        )

        self.tree.heading("tipo", text="Tipo")
        self.tree.heading("busqueda", text="Expediente/Nombre")
        self.tree.heading("juzgado", text="Juzgado/Sala")

        self.tree.column("tipo", width=80, anchor=tk.CENTER)
        self.tree.column("busqueda", width=150, anchor=tk.W)
        self.tree.column("juzgado", width=300, anchor=tk.W)

        self.tree.pack(fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.tree.yview)

        # Botones de gestión de lista
        frame_botones_lista = tk.Frame(frame_derecha)
        frame_botones_lista.pack(fill=tk.X, pady=10)

        btn_eliminar = tk.Button(
            frame_botones_lista,
            text="🗑️ Eliminar Seleccionado",
            command=self.eliminar_expediente,
            bg="#f44336",
            fg="white",
            font=("Arial", 10),
            padx=10,
            pady=8,
            cursor="hand2"
        )
        btn_eliminar.pack(side=tk.LEFT, padx=(0, 5))

        btn_limpiar_todo = tk.Button(
            frame_botones_lista,
            text="🗑️ Limpiar Todo",
            command=self.limpiar_todos,
            bg="#e91e63",
            fg="white",
            font=("Arial", 10),
            padx=10,
            pady=8,
            cursor="hand2"
        )
        btn_limpiar_todo.pack(side=tk.LEFT)

        # ========== FRAME INFERIOR - ACCIONES ==========
        frame_inferior = tk.Frame(self.root, bg="#f5f5f5", height=80)
        frame_inferior.pack(fill=tk.X, padx=0, pady=0)

        frame_acciones = tk.Frame(frame_inferior, bg="#f5f5f5")
        frame_acciones.pack(pady=15)

        btn_ejecutar = tk.Button(
            frame_acciones,
            text="🚀 EJECUTAR BÚSQUEDA",
            command=self.ejecutar_busqueda,
            bg="#2196F3",
            fg="white",
            font=("Arial", 14, "bold"),
            padx=40,
            pady=15,
            cursor="hand2",
            relief=tk.RAISED,
            borderwidth=3
        )
        btn_ejecutar.pack(side=tk.LEFT, padx=5)

        btn_guardar = tk.Button(
            frame_acciones,
            text="💾 Guardar Expedientes",
            command=self.guardar_expedientes,
            bg="#FF9800",
            fg="white",
            font=("Arial", 11),
            padx=20,
            pady=12,
            cursor="hand2"
        )
        btn_guardar.pack(side=tk.LEFT, padx=5)

    def cambiar_tipo_busqueda(self):
        """Cambia las etiquetas según el tipo de búsqueda"""
        if self.tipo_busqueda.get() == "numero":
            self.label_texto.config(text="Número de expediente:")
            self.label_ejemplo.config(text="Ejemplo: 2358/2025")
            self.entry_texto.delete(0, tk.END)
        else:
            self.label_texto.config(text="Nombre del actor/parte:")
            self.label_ejemplo.config(text="Ejemplo: JUAN PEREZ LOPEZ")
            self.entry_texto.delete(0, tk.END)

    def agregar_expediente(self):
        """Agrega un expediente a la lista"""
        texto = self.entry_texto.get().strip()
        juzgado = self.combo_juzgado.get().strip()
        comentario = self.entry_comentario.get().strip()

        # Validaciones
        if not texto:
            messagebox.showwarning("Advertencia", "Debes ingresar un número de expediente o nombre")
            return

        if not juzgado or juzgado.startswith("📍") or juzgado.startswith("🏛️") or juzgado == "---":
            messagebox.showwarning("Advertencia", "Debes seleccionar un juzgado/sala válido")
            return

        # Crear expediente
        expediente = {
            "juzgado": juzgado
        }

        if self.tipo_busqueda.get() == "numero":
            expediente["numero"] = texto
        else:
            expediente["nombre"] = texto

        if comentario:
            expediente["comentario"] = comentario

        # Verificar duplicados
        for exp in self.expedientes:
            if (exp.get("numero") == texto or exp.get("nombre") == texto) and exp.get("juzgado") == juzgado:
                messagebox.showwarning("Advertencia", "Este expediente ya está en la lista")
                return

        # Agregar a la lista
        self.expedientes.append(expediente)
        self.actualizar_lista_expedientes()
        self.limpiar_formulario()

        messagebox.showinfo("Éxito", f"Expediente agregado correctamente\n\nTotal: {len(self.expedientes)} expedientes")

    def eliminar_expediente(self):
        """Elimina el expediente seleccionado"""
        seleccion = self.tree.selection()
        if not seleccion:
            messagebox.showwarning("Advertencia", "Debes seleccionar un expediente de la lista")
            return

        # Obtener índice
        item = seleccion[0]
        index = self.tree.index(item)

        # Confirmar
        if messagebox.askyesno("Confirmar", "¿Eliminar este expediente de la lista?"):
            del self.expedientes[index]
            self.actualizar_lista_expedientes()
            messagebox.showinfo("Éxito", "Expediente eliminado")

    def limpiar_todos(self):
        """Elimina todos los expedientes"""
        if not self.expedientes:
            messagebox.showinfo("Información", "La lista ya está vacía")
            return

        if messagebox.askyesno("Confirmar", f"¿Eliminar TODOS los {len(self.expedientes)} expedientes?"):
            self.expedientes = []
            self.actualizar_lista_expedientes()
            messagebox.showinfo("Éxito", "Todos los expedientes eliminados")

    def limpiar_formulario(self):
        """Limpia el formulario"""
        self.entry_texto.delete(0, tk.END)
        self.entry_comentario.delete(0, tk.END)
        self.entry_texto.focus()

    def actualizar_lista_expedientes(self):
        """Actualiza la vista de expedientes en el TreeView"""
        # Limpiar
        for item in self.tree.get_children():
            self.tree.delete(item)

        # Agregar expedientes
        for exp in self.expedientes:
            tipo = "📄 Expediente" if "numero" in exp else "👤 Nombre"
            busqueda = exp.get("numero", exp.get("nombre", "N/A"))
            juzgado = exp.get("juzgado", "N/A")

            # Truncar si es muy largo
            if len(juzgado) > 45:
                juzgado = juzgado[:42] + "..."

            self.tree.insert("", tk.END, values=(tipo, busqueda, juzgado))

        # Actualizar contador
        self.label_contador.config(text=f"({len(self.expedientes)} expedientes)")

    def cargar_expedientes(self):
        """Carga expedientes desde el archivo JSON"""
        try:
            if os.path.exists(self.archivo_json):
                with open(self.archivo_json, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.expedientes = data.get('expedientes', [])
        except Exception as e:
            messagebox.showerror("Error", f"Error al cargar expedientes: {e}")

    def guardar_expedientes(self):
        """Guarda expedientes en el archivo JSON"""
        try:
            # Cargar estructura completa del JSON
            data = {}
            if os.path.exists(self.archivo_json):
                with open(self.archivo_json, 'r', encoding='utf-8') as f:
                    data = json.load(f)

            # Actualizar solo la sección de expedientes
            data['expedientes'] = self.expedientes

            # Guardar
            with open(self.archivo_json, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            messagebox.showinfo("Éxito", f"✅ {len(self.expedientes)} expedientes guardados en {self.archivo_json}")

        except Exception as e:
            messagebox.showerror("Error", f"Error al guardar: {e}")

    def ejecutar_busqueda(self):
        """Ejecuta el script de búsqueda"""
        if not self.expedientes:
            messagebox.showwarning("Advertencia", "No hay expedientes para buscar.\n\nAgrega al menos un expediente primero.")
            return

        # Guardar primero
        self.guardar_expedientes()

        # Confirmar
        respuesta = messagebox.askyesno(
            "Confirmar Búsqueda",
            f"Se buscarán {len(self.expedientes)} expedientes\n\n¿Deseas continuar?"
        )

        if not respuesta:
            return

        # Ejecutar en un hilo separado para no bloquear la GUI
        threading.Thread(target=self.ejecutar_script, daemon=True).start()

        messagebox.showinfo(
            "Búsqueda Iniciada",
            "🚀 La búsqueda ha comenzado en segundo plano.\n\n"
            "Se abrirá una ventana de Chrome con las búsquedas.\n\n"
            "Al finalizar se generará el archivo Excel con los resultados."
        )

    def ejecutar_script(self):
        """Ejecuta el script de búsqueda en segundo plano"""
        try:
            # Obtener ruta absoluta del script
            script_dir = os.path.dirname(os.path.abspath(__file__))
            script_path = os.path.join(script_dir, "buscar_expedientes.py")

            # Ejecutar script principal desde su directorio
            subprocess.run(["python3", script_path], cwd=script_dir, check=True)
        except subprocess.CalledProcessError as e:
            messagebox.showerror("Error", f"Error al ejecutar búsqueda:\n{e}")
        except FileNotFoundError:
            try:
                # Intentar con 'python' si 'python3' no existe
                script_dir = os.path.dirname(os.path.abspath(__file__))
                script_path = os.path.join(script_dir, "buscar_expedientes.py")
                subprocess.run(["python", script_path], cwd=script_dir, check=True)
            except Exception as e:
                messagebox.showerror("Error", f"No se pudo ejecutar el script:\n{e}")


def main():
    root = tk.Tk()
    app = ExpedientesGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
