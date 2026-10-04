import { Checkbox, FormControlLabel } from "@mui/material";
import { useFormContext, Controller } from "react-hook-form"


interface iCheckboxFieldProps {
    label: string;
    name: string;

    onChange?: (value: boolean) => void;
    helperText?: string;
}


const PSCheckboxField = ({ label, name, }: iCheckboxFieldProps) => {

    const { control, formState: { errors }, } = useFormContext();



    return <Controller
        name={name}
        control={control}
        render={(thing) => {

            // const labelID = name.replaceAll('.', '_').replaceAll('[', '').replaceAll(']', '')
            // const hText: string = (errors[name]?.message ? errors[name].message?.toString() : helperText);
            // const error: boolean = (errors[name]?.message ? true : false)
            const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
                thing.field.onChange(event.target.checked);
            };
            console.log(errors);
            return <FormControlLabel
                label={label}
                control={<Checkbox
                    checked={thing.field.value?thing.field.value:false}
                    onChange={handleChange}
                />} />
        }} />



}


export default PSCheckboxField;